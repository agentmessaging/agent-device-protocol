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
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "nvs_flash.h"
#include "sodium.h"

#if CONFIG_ADP_DISPLAY_TEXT
// Supplied by your board port (see README). Returns 0 when the text is on the screen.
int adp_board_show_text(const char *text, void *user);
#endif

static const char *TAG = "adp";
typedef struct {
  char *data;  // NULL: the connection ended
  size_t len;
} frame_t;
static QueueHandle_t frames;
static EventGroupHandle_t wifi;
static char *rx;
static volatile int64_t last_rx;
static volatile int http_status;
static char refusal[32];

static int64_t now_ms(void) { return esp_timer_get_time() / 1000; }

static void on_wifi(void *arg, esp_event_base_t base, int32_t id, void *data) {
  if (base == WIFI_EVENT && (id == WIFI_EVENT_STA_START || id == WIFI_EVENT_STA_DISCONNECTED)) {
    xEventGroupClearBits(wifi, 1);
    esp_wifi_connect();
  } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
    xEventGroupSetBits(wifi, 1);
  }
}

static void start_wifi(void) {
  wifi = xEventGroupCreate();
  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  esp_netif_create_default_wifi_sta();
  wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_wifi_init(&init));
  ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_wifi, NULL));
  ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_wifi, NULL));
  wifi_config_t config = {0};
  strlcpy((char *)config.sta.ssid, CONFIG_ADP_WIFI_SSID, sizeof config.sta.ssid);
  strlcpy((char *)config.sta.password, CONFIG_ADP_WIFI_PASSWORD, sizeof config.sta.password);
  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
  ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &config));
  ESP_ERROR_CHECK(esp_wifi_start());
}

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

// protocol/reverse.md allows Tailscale and loopback addresses; a board on a home LAN also needs private ones.
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
    last_rx = now_ms();  // any frame, pings included, shows the controller is there
    if (d->op_code == 0x8 && d->data_len > 2 && ((uint8_t)d->data_ptr[0] << 8 | (uint8_t)d->data_ptr[1]) == 4003)
      snprintf(refusal, sizeof refusal, "%.*s", d->data_len - 2, d->data_ptr + 2);
    if (d->op_code != 0x1 || d->payload_len > ADP_MAX_FRAME) return;  // oversized frames are dropped
    if (d->payload_offset == 0) {
      free(rx);
      rx = malloc(d->payload_len + 1);
    }
    if (!rx || d->payload_offset + d->data_len > d->payload_len) return;
    memcpy(rx + d->payload_offset, d->data_ptr, d->data_len);
    if (d->payload_offset + d->data_len < d->payload_len) return;
    frame_t f = {rx, d->payload_len};
    rx = NULL;
    if (xQueueSend(frames, &f, 0) != pdTRUE) free(f.data);
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
      .disable_auto_reconnect = true,  // reverse.md backoff and refusal rules are applied below
      .buffer_size = 2048,
      .network_timeout_ms = 10000,
      .task_stack = 6144,
  };
  esp_websocket_client_handle_t client = esp_websocket_client_init(&config);
  if (!client) return false;
  esp_websocket_register_events(client, WEBSOCKET_EVENT_ANY, on_ws, NULL);
  adp_new_session(adp);
  refusal[0] = 0;
  http_status = 0;
  int64_t opened = last_rx = now_ms();
  esp_websocket_client_start(client);
  for (;;) {
    frame_t f;
    if (xQueueReceive(frames, &f, pdMS_TO_TICKS(100)) == pdTRUE) {
      if (!f.data) break;
      char *out = NULL;
      int was = adp->state, rc = adp_handle(adp, f.data, f.len, now_ms(), &out);
      free(f.data);
      if (out) esp_websocket_client_send_text(client, out, strlen(out), pdMS_TO_TICKS(5000));
      free(out);
      if (rc) break;
      if (was < 2 && adp->state == 2) ESP_LOGI(TAG, "Connected to the controller for %s", adp->agent);
    }
    if (adp->state < 2 && now_ms() - opened > 5000) break;  // handshake bound
    if (now_ms() - last_rx > 35000) break;                  // controller went silent
  }
  esp_websocket_client_destroy(client);
  frame_t f;
  while (xQueueReceive(frames, &f, 0) == pdTRUE) free(f.data);
  free(rx);
  rx = NULL;
  return adp->state == 2;
}

void app_main(void) {
  if (!*CONFIG_ADP_WIFI_SSID || !private_url(CONFIG_ADP_CONTROLLER_URL)) {
    ESP_LOGE(TAG, "Set Wi-Fi and a ws://PRIVATE_IPV4:PORT controller address in menuconfig");
    return;
  }
  esp_err_t err = nvs_flash_init();  // with CONFIG_NVS_ENCRYPTION this opens the encrypted partition
  if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
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
#if CONFIG_ADP_DISPLAY_TEXT
  adp.show_text = adp_board_show_text;
#endif
  ESP_LOGI(TAG, "Device public key (safe to share): %s", adp.key);

  static char uri[sizeof CONFIG_ADP_CONTROLLER_URL + 64];
  snprintf(uri, sizeof uri, "%s/v1/connect/%s", CONFIG_ADP_CONTROLLER_URL, adp.key);
  // reverse.md: backoff from one to thirty seconds plus up to 25% jitter, reset by a good session;
  // after a final refusal, two more tries, then stop until the owner restarts the board.
  int backoff = 1000, refused = 0;
  for (;;) {
    xEventGroupWaitBits(wifi, 1, pdFALSE, pdTRUE, portMAX_DELAY);
    bool ok = session(&adp, uri);
    bool final = http_status == 403 || !strcmp(refusal, "unknown_device") || !strcmp(refusal, "not_owner") ||
                 !strcmp(refusal, "revoked") || !strcmp(refusal, "unsupported_version");
    refused = final ? refused + 1 : 0;
    if (refused >= 3) {
      ESP_LOGE(TAG, "The controller refused this device (%s). Stopped until restart.",
               *refusal ? refusal : "unknown_device");
      return;
    }
    if (ok) backoff = 1000;
    ESP_LOGW(TAG, "Disconnected; retrying in about %d s", backoff / 1000);
    vTaskDelay(pdMS_TO_TICKS(backoff + esp_random() % (backoff / 4 + 1)));
    backoff = backoff * 2 > 30000 ? 30000 : backoff * 2;
  }
}
