// Wi-Fi for a board that travels (S005): up to 8 networks in NVS; at start and after a lost connection the board
// scans and joins the strongest network it knows, then the next. The network built into the firmware is one of
// them. The ESP-IDF Wi-Fi driver keeps no copy (RAM storage), so a password lives in one place only, and the
// list is erased when the board is assigned to another controller or agent (a transfer).
#include <stdlib.h>
#include <string.h>

#include "esp_event.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "nets.h"
#include "nvs.h"
#include "sdkconfig.h"
#if CONFIG_ADP_SETUP_MODE
#include "esp_random.h"
#include "esp_srp.h"
#include "network_provisioning/manager.h"
#include "network_provisioning/scheme_ble.h"
#endif

#define CONNECTED BIT0  // what the rest of the firmware waits for
#define LOST BIT1       // scan and join again
#define FAILED BIT2     // this attempt ended
#define RETRY_MS 10000  // with no known network in range
#define SETUP_AFTER 3   // scans with no known network before the setup mode opens (about 30 s)
#define SETUP_MS (10 * 60 * 1000)
#define SETUP_DONE BIT3
#define AGAIN_MS 2000   // a known network was there but refused us: access points refuse an association now and then

static const char *TAG = "net";
static EventGroupHandle_t ev;
static SemaphoreHandle_t mu;
static adp_nets_t nets;
static char current[33];

static void save(void) {
  nvs_handle_t h;
  if (nvs_open("adp_net", NVS_READWRITE, &h)) return;
  if (nvs_set_blob(h, "list", &nets, sizeof nets) || nvs_commit(h)) ESP_LOGE(TAG, "Could not save the networks");
  nvs_close(h);
}

static void load(void) {
  nvs_handle_t h;
  size_t len = sizeof nets;
  char owner[sizeof CONFIG_ADP_CONTROLLER_KEY + sizeof CONFIG_ADP_ASSIGNED_AGENT + 1] = "", was[sizeof owner] = "";
  snprintf(owner, sizeof owner, "%s %s", CONFIG_ADP_CONTROLLER_KEY, CONFIG_ADP_ASSIGNED_AGENT);
  if (nvs_open("adp_net", NVS_READWRITE, &h)) return;
  size_t was_len = sizeof was;
  bool same_owner = nvs_get_str(h, "owner", was, &was_len) == ESP_OK && !strcmp(was, owner);
  if (!same_owner || nvs_get_blob(h, "list", &nets, &len) != ESP_OK || len != sizeof nets || nets.n < 0 ||
      nets.n > ADP_NETWORKS) {
    if (!same_owner && *was) ESP_LOGW(TAG, "New controller or agent: the stored networks and the setup code are erased");
    memset(&nets, 0, sizeof nets);
    nvs_erase_key(h, "list");
    if (!same_owner) nvs_erase_key(h, "setup");  // a new owner gets a new setup code
    nvs_set_str(h, "owner", owner);
    nvs_commit(h);
  }
  nvs_close(h);
}

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data) {
  if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
    xEventGroupSetBits(ev, LOST);
  } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
    xEventGroupClearBits(ev, CONNECTED);
    xEventGroupSetBits(ev, LOST | FAILED);
  } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
    xEventGroupSetBits(ev, CONNECTED);
  }
}

static int by_signal(const void *a, const void *b) {
  return ((const wifi_ap_record_t *)b)->rssi - ((const wifi_ap_record_t *)a)->rssi;
}

// Tries the known networks in range, strongest first. True when one gave an address; *seen counts the known
// networks that were in range.
static bool join(int *seen_known) {
  wifi_scan_config_t scan = {.show_hidden = false};
  uint16_t n = 32;
  wifi_ap_record_t *aps = calloc(n, sizeof *aps);
  if (!aps || esp_wifi_scan_start(&scan, true) || esp_wifi_scan_get_ap_records(&n, aps)) {
    free(aps);
    return false;
  }
  qsort(aps, n, sizeof *aps, by_signal);
  bool joined = false;
  for (int i = 0; i < n && !joined; i++) {
    bool seen = false;  // a network with several access points: the strongest one only
    for (int j = 0; j < i; j++) seen |= !strcmp((char *)aps[j].ssid, (char *)aps[i].ssid);
    wifi_config_t c = {0};
    xSemaphoreTake(mu, portMAX_DELAY);
    const adp_net_t *e = seen ? NULL : adp_nets_find(&nets, (char *)aps[i].ssid);
    if (e) {
      memcpy(c.sta.ssid, e->ssid, sizeof e->ssid - 1);
      memcpy(c.sta.password, e->pass, sizeof e->pass - 1);
    }
    xSemaphoreGive(mu);
    if (!e) continue;
    (*seen_known)++;
    ESP_LOGI(TAG, "Joining %s (%d dBm)", (char *)c.sta.ssid, aps[i].rssi);
    xEventGroupClearBits(ev, FAILED | CONNECTED);
    if (!esp_wifi_set_config(WIFI_IF_STA, &c) && !esp_wifi_connect()) {
      EventBits_t b = xEventGroupWaitBits(ev, CONNECTED | FAILED, pdFALSE, pdFALSE, pdMS_TO_TICKS(15000));
      joined = b & CONNECTED;
    }
    if (joined) {
      xSemaphoreTake(mu, portMAX_DELAY);
      strlcpy(current, (char *)c.sta.ssid, sizeof current);
      adp_nets_joined(&nets, current);
      save();
      xSemaphoreGive(mu);
      ESP_LOGI(TAG, "Joined %s", current);
    } else {
      esp_wifi_disconnect();
    }
    memset(&c, 0, sizeof c);  // the password leaves the stack
  }
  free(aps);
  return joined;
}

__attribute__((weak)) void adp_sign_setup(bool on) { (void)on; }  // board_sign.c: a slow blink

#if CONFIG_ADP_SETUP_MODE
// S005 local setup mode: Espressif's provisioning over Bluetooth LE, security 2 (SRP6a) with the setup code. The
// owner's phone sends one network; it is stored like network.add. Never opened by a controller.
static const char SETUP_USER[] = "wifiprov";  // the username Espressif's apps and esp_prov use

// Made once and kept in NVS. Printed with printf, not the log, so a debug build never sends it over Wi-Fi.
static void setup_code(char code[10]) {
  nvs_handle_t h;
  size_t len = 10;
  if (nvs_open("adp_net", NVS_READWRITE, &h)) return;
  if (nvs_get_str(h, "setup", code, &len) != ESP_OK) {
    static const char abc[] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";  // no 0/O, 1/I
    for (int i = 0; i < 9; i++) code[i] = i == 4 ? '-' : abc[esp_random() % 32];
    code[9] = 0;
    nvs_set_str(h, "setup", code);
    nvs_commit(h);
  }
  nvs_close(h);
}

// The debug console's "setup-code": forget the code; the next setup mode makes a new one and prints it
void adp_net_new_setup_code(void) {
  nvs_handle_t h;
  if (nvs_open("adp_net", NVS_READWRITE, &h)) return;
  nvs_erase_key(h, "setup");
  nvs_commit(h);
  nvs_close(h);
  char code[10] = "";
  setup_code(code);
  printf("\nNew setup code: %s\n", code);  // USB console only, never the log
  memset(code, 0, sizeof code);
}

static void on_prov(void *arg, esp_event_base_t base, int32_t id, void *data) {
  if (id == NETWORK_PROV_WIFI_CRED_RECV) {
    wifi_sta_config_t *c = data;
    xSemaphoreTake(mu, portMAX_DELAY);
    int n = adp_nets_add(&nets, (char *)c->ssid, (char *)c->password);
    save();
    xSemaphoreGive(mu);
    ESP_LOGI(TAG, "Setup: network %s received (%d stored)", (char *)c->ssid, n);
  } else if (id == NETWORK_PROV_WIFI_CRED_FAIL) {
    ESP_LOGW(TAG, "Setup: could not join that network; the phone can send another");
  } else if (id == NETWORK_PROV_WIFI_CRED_SUCCESS) {
    xEventGroupSetBits(ev, SETUP_DONE);
  }
}

static void setup_mode(void) {
  char code[10] = "", name[16];
  setup_code(code);
  if (!*code) return;
  extern const char *adp_device_key(void);  // main.c
  snprintf(name, sizeof name, "ADP_%.8s", adp_device_key());
  char *salt = NULL, *verifier = NULL;
  int verifier_len = 0;
  if (esp_srp_gen_salt_verifier(SETUP_USER, strlen(SETUP_USER), code, strlen(code), &salt, 16, &verifier, &verifier_len)) return;
  network_prov_security2_params_t sec = {.salt = salt, .salt_len = 16, .verifier = verifier, .verifier_len = verifier_len};
  network_prov_mgr_config_t cfg = {.scheme = network_prov_scheme_ble, .scheme_event_handler = NETWORK_PROV_EVENT_HANDLER_NONE};
  xEventGroupClearBits(ev, SETUP_DONE);
  // Wi-Fi and Bluetooth share the radio: Bluetooth needs Wi-Fi modem sleep, or the phone loses the link as soon as the
  // board joins. The speaker build turns modem sleep off for fast speech; it goes back after the setup mode.
  wifi_ps_type_t ps = WIFI_PS_MIN_MODEM;
  esp_wifi_get_ps(&ps);
  esp_wifi_set_ps(WIFI_PS_MIN_MODEM);
  if (network_prov_mgr_init(cfg) == ESP_OK) {
    esp_event_handler_register(NETWORK_PROV_EVENT, ESP_EVENT_ANY_ID, on_prov, NULL);
    // When the phone reads "connected", the manager closes Bluetooth after this delay (1 s by default): too soon for
    // the answer to reach a phone on macOS
    esp_err_t no_auto = network_prov_mgr_disable_auto_stop(5000);
    if (no_auto) ESP_LOGW(TAG, "Setup mode: the manager will stop by itself (%s)", esp_err_to_name(no_auto));
    if (network_prov_mgr_start_provisioning(NETWORK_PROV_SECURITY_2, &sec, name, NULL) == ESP_OK) {
      printf("\nSetup mode: Bluetooth name %s, setup code %s\n", name, code);  // USB console only
      ESP_LOGW(TAG, "No known network: setup mode open on Bluetooth as %s for %d minutes", name, SETUP_MS / 60000);
      adp_sign_setup(true);
      bool done = xEventGroupWaitBits(ev, SETUP_DONE, pdTRUE, pdFALSE, pdMS_TO_TICKS(SETUP_MS)) & SETUP_DONE;
      ESP_LOGI(TAG, "Setup mode: %s", done ? "joined the new network" : "closed after 10 minutes");
      adp_sign_setup(false);
      network_prov_mgr_stop_provisioning();
      if (done) vTaskDelay(pdMS_TO_TICKS(12000));  // so the phone reads "connected" before Bluetooth closes
    }
    esp_event_handler_unregister(NETWORK_PROV_EVENT, ESP_EVENT_ANY_ID, on_prov);
    network_prov_mgr_deinit();
  }
  esp_wifi_set_ps(ps);
  free(salt);
  free(verifier);
  memset(code, 0, sizeof code);
}
#endif

static void join_task(void *arg) {
  int empty = 0;  // scans in a row with no known network
  for (;;) {
    xEventGroupWaitBits(ev, LOST, pdTRUE, pdFALSE, portMAX_DELAY);
    current[0] = 0;
    int seen = 0;
    if (join(&seen)) {
      xEventGroupClearBits(ev, LOST);  // failed attempts before the good one set it
      empty = 0;
      continue;
    }
    empty = seen ? 0 : empty + 1;
#if CONFIG_ADP_SETUP_MODE
    if (empty >= SETUP_AFTER) {
      empty = 0;
      setup_mode();
      if (xEventGroupGetBits(ev) & CONNECTED) {
        xEventGroupClearBits(ev, LOST);
        continue;
      }
      xEventGroupSetBits(ev, LOST);
      continue;
    }
#endif
    if (seen)
      ESP_LOGW(TAG, "Could not join a known network; trying again in %d s", AGAIN_MS / 1000);
    else
      ESP_LOGW(TAG, "No known network in range (%d stored); scanning again in %d s", nets.n, RETRY_MS / 1000);
    vTaskDelay(pdMS_TO_TICKS(seen ? AGAIN_MS : RETRY_MS));
    xEventGroupSetBits(ev, LOST);
  }
}

// After esp_wifi_init(). Sets CONNECTED (BIT0) on the group while the board has an address.
void adp_net_start(EventGroupHandle_t group) {
  ev = group;
  mu = xSemaphoreCreateMutex();
  load();
  if (*CONFIG_ADP_WIFI_SSID) {  // the network built into the firmware is always one of them
    const adp_net_t *e = adp_nets_find(&nets, CONFIG_ADP_WIFI_SSID);
    if (!e || strcmp(e->pass, CONFIG_ADP_WIFI_PASSWORD)) {
      adp_nets_add(&nets, CONFIG_ADP_WIFI_SSID, CONFIG_ADP_WIFI_PASSWORD);
      save();
    }
  }
  ESP_LOGI(TAG, "%d network%s stored", nets.n, nets.n == 1 ? "" : "s");
  esp_wifi_set_storage(WIFI_STORAGE_RAM);
  ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_event, NULL));
  ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, NULL));
  xTaskCreate(join_task, "net", 4096, NULL, 4, NULL);
}

// S005 capabilities (adp.h)
int adp_net_add(const char *ssid, const char *password, int *count, void *user) {
  xSemaphoreTake(mu, portMAX_DELAY);
  *count = adp_nets_add(&nets, ssid, password);
  save();
  xSemaphoreGive(mu);
  ESP_LOGI(TAG, "Network %s stored (%d)", ssid, *count);  // never the password
  if (!(xEventGroupGetBits(ev) & CONNECTED)) xEventGroupSetBits(ev, LOST);
  return 0;
}

int adp_net_remove(const char *ssid, bool *removed, int *count, void *user) {
  xSemaphoreTake(mu, portMAX_DELAY);
  *removed = adp_nets_remove(&nets, ssid);
  *count = nets.n;
  if (*removed) save();
  xSemaphoreGive(mu);
  if (*removed) ESP_LOGI(TAG, "Network %s removed (%d)", ssid, *count);
  return 0;
}

int adp_net_list(char names[][33], char cur[33], char setup[16], void *user) {
  setup[0] = 0;
#if CONFIG_ADP_SETUP_MODE
  char code[10] = "";
  setup_code(code);  // made now if it does not exist yet, so the owner's app has it before the board travels
  strlcpy(setup, code, 16);
  memset(code, 0, sizeof code);
#endif
  xSemaphoreTake(mu, portMAX_DELAY);
  for (int i = 0; i < nets.n; i++) strlcpy(names[i], nets.e[i].ssid, 33);
  strlcpy(cur, (xEventGroupGetBits(ev) & CONNECTED) ? current : "", 33);
  int n = nets.n;
  xSemaphoreGive(mu);
  return n;
}
