// ESP32 device for the Agent Device Protocol: Wi-Fi, the device key in NVS, and the outbound
// WebSocket of protocol/reverse.md. The protocol itself is in adp.c.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "adp.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_websocket_client.h"
#include "esp_wifi.h"
#include "esp_crt_bundle.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "nvs_flash.h"
#include "sodium.h"

#if CONFIG_ADP_DISPLAY_TEXT
// Supplied by your board port (see README). Returns 0 when the text is on the screen.
int adp_board_show_text(const char *text, void *user);
#endif
#if CONFIG_ADP_CAMERA
int adp_board_camera_init(void);  // board_camera.c
void adp_board_doctor(EventGroupHandle_t wifi, const char *url);  // board_doctor.c
int adp_board_audio_init(bool microphone, bool speaker);
bool adp_board_listening(void);
void adp_net_start(EventGroupHandle_t wifi);  // networks.c
int adp_net_add(const char *ssid, const char *password, int *count, void *user);
int adp_net_remove(const char *ssid, bool *removed, int *count, void *user);
int adp_net_list(char names[][33], char current[33], void *user);          // board_audio.c
int adp_board_play(const unsigned char *wav, size_t len, bool *played, void *user);
bool adp_board_take_talk(unsigned char **wav, size_t *len);
int adp_board_snapshot(unsigned char **jpeg, size_t *len, void *user);
#endif

static const char *TAG = "adp";
#ifdef CONFIG_ADP_MICROPHONE
#define MICROPHONE_ON true
#else
#define MICROPHONE_ON false
#endif
#ifdef CONFIG_ADP_SPEAKER
#define SPEAKER_ON true
#else
#define SPEAKER_ON false
#endif
typedef struct {
  char *data;  // NULL: the connection ended
  size_t len;
  bool binary;  // S003: every message after the key exchange is binary
} frame_t;
// An encrypted message carries a whole frame plus the 16-byte tag
#define MAX_MESSAGE (ADP_MAX_FRAME + 16)
static QueueHandle_t frames;
static EventGroupHandle_t wifi;
static char *rx;
static int64_t rx_started;  // when the first piece of the current message arrived
static volatile uint32_t last_rx;  // 32 bits: one store, so the main task never reads half of it
static volatile int http_status;
static char refusal[32];

static int64_t now_ms(void) { return esp_timer_get_time() / 1000; }

static void start_wifi(void) {
  wifi = xEventGroupCreate();
  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  esp_netif_create_default_wifi_sta();
  wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_wifi_init(&init));
  adp_net_start(wifi);  // networks.c: which network to join, and the bit main waits for
  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
  ESP_ERROR_CHECK(esp_wifi_start());
#if CONFIG_ADP_SPEAKER
  // Modem sleep holds each packet until the next beacon: 330 KB of speech took 5 s, too slow for a sentence
  // to start right after the last one. A board with a speaker runs on mains or USB power.
  esp_wifi_set_ps(WIFI_PS_NONE);
#endif
}

static char device_public_key[ADP_KEY];
// For the setup mode's Bluetooth name (networks.c): the public key, never the agent
const char *adp_device_key(void) { return device_public_key; }

// Created on first boot and kept in NVS. Runs after Wi-Fi starts: the radio feeds the hardware RNG.
static void device_key(unsigned char sk[64]) {
  nvs_handle_t nvs;
  size_t len = 64;
  ESP_ERROR_CHECK(nvs_open("adp", NVS_READWRITE, &nvs));
  if (nvs_get_blob(nvs, "sk", sk, &len) != ESP_OK || len != 64) {
    unsigned char pk[32];
    crypto_sign_keypair(pk, sk);
    ESP_ERROR_CHECK(nvs_set_blob(nvs, "sk", sk, 64));
    ESP_ERROR_CHECK(nvs_commit(nvs));
    ESP_LOGI(TAG, "Created a new device key");
  }
  nvs_close(nvs);
#if !CONFIG_NVS_ENCRYPTION
  ESP_LOGW(TAG, "NVS is not encrypted: anyone holding this board can read its device key");
#endif
}

// protocol/reverse.md allows Tailscale, loopback and, with limits, private network addresses (Home network connections).
// S006: a relay is wss://NAME[:PORT] with no path; TLS with public roots carries it, S003 inside is the trust
static bool relay_url(const char *url) {
  const char *host = url + 6;
  return !strncmp(url, "wss://", 6) && *host && !strpbrk(host, "/@?#") && strlen(url) < 200;
}

static bool private_url(const char *url) {
  unsigned a, b, c, d, port;
  char rest;
  if (sscanf(url, "ws://%u.%u.%u.%u:%u%c", &a, &b, &c, &d, &port, &rest) != 5 || a > 255 || b > 255 ||
      c > 255 || d > 255 || !port || port > 65535)
    return false;
  return a == 127 || a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) ||
         (a == 100 && b >= 64 && b <= 127);
}

static void on_ws(void *arg, esp_event_base_t base, int32_t id, void *event) {
  esp_websocket_event_data_t *d = event;
  frame_t end = {0};
  if (id == WEBSOCKET_EVENT_DATA) {
    last_rx = (uint32_t)now_ms();  // any frame, pings included, shows the controller is there
    if (d->op_code == 0x8 && d->data_len > 2 && ((uint8_t)d->data_ptr[0] << 8 | (uint8_t)d->data_ptr[1]) == 4003)
      snprintf(refusal, sizeof refusal, "%.*s", d->data_len - 2, d->data_ptr + 2);
    if (d->op_code != 0x1 && d->op_code != 0x2) return;
    if (d->payload_len > MAX_MESSAGE) {
      if (d->payload_offset == 0) ESP_LOGW(TAG, "Dropped a %d-byte frame (limit %d)", d->payload_len, MAX_MESSAGE);
      return;
    }
    if (d->payload_offset == 0) {
      rx_started = now_ms();
      free(rx);
      rx = malloc(d->payload_len + 1);
    }
    if (!rx || d->payload_offset + d->data_len > d->payload_len) return;
    memcpy(rx + d->payload_offset, d->data_ptr, d->data_len);
    if (d->payload_offset + d->data_len < d->payload_len) return;
    if (d->payload_len > 65536)
      ESP_LOGI(TAG, "Received %d bytes in %d ms", d->payload_len, (int)(now_ms() - rx_started));
    frame_t f = {rx, d->payload_len, d->op_code == 0x2};
    rx = NULL;
    if (xQueueSend(frames, &f, 0) != pdTRUE) {
      ESP_LOGW(TAG, "Dropped a frame: the queue is full");
      free(f.data);
    }
  } else if (id == WEBSOCKET_EVENT_ERROR) {
    http_status = d->error_handle.esp_ws_handshake_status_code;
  } else if (id == WEBSOCKET_EVENT_DISCONNECTED || id == WEBSOCKET_EVENT_CLOSED) {
    xQueueSend(frames, &end, 0);
  }
}

// One connection: handshake, then answer calls until it ends. Returns true when authenticated.
static bool session(adp_t *adp, const char *uri) {
  esp_websocket_client_config_t config = {
      .uri = uri,
      .crt_bundle_attach = strncmp(uri, "wss://", 6) ? NULL : esp_crt_bundle_attach,
      .disable_auto_reconnect = true,  // reverse.md backoff and refusal rules are applied below
      .buffer_size = 16384,  // also the send fragment size: a clip of 0.8 MB goes out far faster
      .network_timeout_ms = 10000,
      .task_stack = 6144,
  };
  esp_websocket_client_handle_t client = esp_websocket_client_init(&config);
  if (!client) return false;
  esp_websocket_register_events(client, WEBSOCKET_EVENT_ANY, on_ws, NULL);
  adp_new_session(adp);
  refusal[0] = 0;
  http_status = 0;
  int64_t opened = now_ms();
  last_rx = (uint32_t)opened;
  esp_websocket_client_start(client);
  for (;;) {
    frame_t f;
    if (xQueueReceive(frames, &f, pdMS_TO_TICKS(100)) == pdTRUE) {
      if (!f.data) break;
      unsigned char *out = NULL;
      size_t out_len = 0;
      bool out_binary = false;
      int64_t began = now_ms();
      int was = adp->state,
          rc = adp_receive(adp, (unsigned char *)f.data, f.len, f.binary, now_ms(), &out, &out_len, &out_binary);
      if (f.len > 65536) ESP_LOGI(TAG, "Handled %d bytes in %d ms", (int)f.len, (int)(now_ms() - began));
      free(f.data);
      TickType_t wait = pdMS_TO_TICKS(5000 + out_len / 50);  // a snapshot is up to 1.9 MB: allow 50 KB/s
      if (out && out_binary)
        esp_websocket_client_send_bin(client, (const char *)out, out_len, wait);
      else if (out)
        esp_websocket_client_send_text(client, (const char *)out, out_len, wait);
      free(out);
      if (rc) break;
      if (was < 2 && adp->state == 2) ESP_LOGI(TAG, "Connected to the controller for %s", adp->agent);
    }
#if CONFIG_ADP_MICROPHONE
    unsigned char *wav, *out;
    size_t wav_len, out_len;
    bool out_binary;
    if (adp->microphone && adp_event_ready(adp) && adp_board_take_talk(&wav, &wav_len)) {
      if (!adp_audio(adp, wav, wav_len, &out, &out_len, &out_binary)) {
        esp_websocket_client_send_bin(client, (const char *)out, out_len, pdMS_TO_TICKS(5000 + out_len / 50));
        free(out);
      }
      free(wav);
    }
#endif
    if (adp->state < 2 && now_ms() - opened > 5000) break;  // handshake bound
    uint32_t seen = last_rx;  // read before the clock, so a newer frame can't make the difference wrap
    if ((uint32_t)now_ms() - seen > 35000) break;  // controller went silent
  }
  esp_websocket_client_destroy(client);
  frame_t f;
  while (xQueueReceive(frames, &f, 0) == pdTRUE) free(f.data);
  free(rx);
  rx = NULL;
  return adp->state == 2;
}

void app_main(void) {
  // A home address, a relay, or both (home first); a relay needs the encrypted connection
  bool home = private_url(CONFIG_ADP_CONTROLLER_URL), relay = relay_url(CONFIG_ADP_RELAY_URL);
  if ((*CONFIG_ADP_CONTROLLER_URL && !home) || (*CONFIG_ADP_RELAY_URL && (!relay || !CONFIG_ADP_SECURE)) ||
      (!home && !relay)) {
    ESP_LOGE(TAG, "Set a ws://PRIVATE_IPV4:PORT controller address and/or a wss://NAME relay in menuconfig");
    return;
  }
  esp_err_t err = nvs_flash_init();  // with CONFIG_NVS_ENCRYPTION this opens the encrypted partition
  if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    ESP_LOGW(TAG, "Erasing NVS: the device key is lost and the device must be paired again");
    ESP_ERROR_CHECK(nvs_flash_erase());
    err = nvs_flash_init();
  }
  ESP_ERROR_CHECK(err);
  if (sodium_init() < 0) abort();
  frames = xQueueCreate(4, sizeof(frame_t));
  start_wifi();

  static adp_t adp;
  unsigned char sk[64];
  device_key(sk);
  if (adp_init(&adp, sk, CONFIG_ADP_CONTROLLER_KEY, CONFIG_ADP_ASSIGNED_AGENT, CONFIG_IDF_TARGET)) {
    ESP_LOGE(TAG, "Set the controller key and the full AMP address of the owning agent in menuconfig");
    return;
  }
  sodium_memzero(sk, sizeof sk);
  strlcpy(device_public_key, adp.key, sizeof device_public_key);
#if CONFIG_ADP_SECURE
  adp.secure = true;
#else
  ESP_LOGW(TAG, "Plain connection: at a home network address only health and screen text are allowed");
#endif
#if CONFIG_ADP_NETWORKS
  adp.net_add = adp_net_add;  // offered only on the encrypted connection (adp.c)
  adp.net_remove = adp_net_remove;
  adp.net_list = adp_net_list;
#endif
#if CONFIG_ADP_DISPLAY_TEXT
  adp.show_text = adp_board_show_text;
#endif
#if CONFIG_ADP_CAMERA
  if (!adp.secure)
    ESP_LOGW(TAG, "camera.snapshot needs the encrypted connection: not offered");
  else if (!adp_board_camera_init())
    adp.snapshot = adp_board_snapshot;
#endif
  ESP_LOGI(TAG, "Device public key (safe to share): %s", adp.key);
#if CONFIG_ADP_DOCTOR
  extern void adp_board_debug_start(void);  // board_debug.c
  adp_board_doctor(wifi, CONFIG_ADP_CONTROLLER_URL);
  adp_board_debug_start();
#endif
#if CONFIG_ADP_MICROPHONE || CONFIG_ADP_SPEAKER
  // What a person says and what the agent plays never cross a plain home network connection
  if (!adp.secure)
    ESP_LOGW(TAG, "The microphone and speaker need the encrypted connection: not offered");
  else if (!adp_board_audio_init(MICROPHONE_ON, SPEAKER_ON)) {
    adp.microphone = MICROPHONE_ON;
#if CONFIG_ADP_LISTEN
    if (adp_board_listening()) adp.wake_phrase = CONFIG_ADP_WAKE_PHRASE;
#endif
#if CONFIG_ADP_SPEAKER
    adp.play = adp_board_play;
#endif
  }
#endif

  // S003: an encrypted device never connects to /v1/connect, so nobody on the network can force it down
  static char uris[2][256];
  int n_uris = 0, at = 0;
  if (home) snprintf(uris[n_uris++], 256, "%s/v1/%s/%s", CONFIG_ADP_CONTROLLER_URL, adp.secure ? "secure" : "connect", adp.key);
  if (relay) snprintf(uris[n_uris++], 256, "%s/v1/secure/%s", CONFIG_ADP_RELAY_URL, adp.key);
  // reverse.md: backoff from one to thirty seconds plus up to 25% jitter, reset by a good session;
  // after a final refusal, two more tries, then stop until the owner restarts the board.
  int backoff = 1000, refused = 0;
  for (;;) {
    xEventGroupWaitBits(wifi, 1, pdFALSE, pdTRUE, portMAX_DELAY);
    const char *uri = uris[at];
    ESP_LOGI(TAG, "Connecting to %.*s", (int)(strstr(uri, "/v1/") - uri), uri);
    bool ok = session(&adp, uri);
    bool final = http_status == 403 || !strcmp(refusal, "unknown_device") || !strcmp(refusal, "not_owner") ||
                 !strcmp(refusal, "revoked") || !strcmp(refusal, "unsupported_version");
    refused = final ? refused + 1 : 0;
    if (refused >= 3) {
      ESP_LOGE(TAG, "The controller refused this device (%s). Stopped until restart.",
               *refusal ? refusal : "unknown_device");
      return;
    }
    if (ok) {
      backoff = 1000;
      at = 0;  // after a good session, home first again
      continue;
    }
    at = (at + 1) % n_uris;
    if (at) continue;  // the next address at once; the backoff is per round
    ESP_LOGW(TAG, "Disconnected; retrying in about %d s", backoff / 1000);
    vTaskDelay(pdMS_TO_TICKS(backoff + esp_random() % (backoff / 4 + 1)));
    backoff = backoff * 2 > 30000 ? 30000 : backoff * 2;
  }
}
