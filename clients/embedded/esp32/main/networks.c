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

#define CONNECTED BIT0  // what the rest of the firmware waits for
#define LOST BIT1       // scan and join again
#define FAILED BIT2     // this attempt ended
#define RETRY_MS 10000  // with no known network in range
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
    if (!same_owner && *was) ESP_LOGW(TAG, "New controller or agent: the stored networks are erased");
    memset(&nets, 0, sizeof nets);
    nvs_erase_key(h, "list");
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

static void join_task(void *arg) {
  for (;;) {
    xEventGroupWaitBits(ev, LOST, pdTRUE, pdFALSE, portMAX_DELAY);
    current[0] = 0;
    int seen = 0;
    if (join(&seen)) {
      xEventGroupClearBits(ev, LOST);  // failed attempts before the good one set it
      continue;
    }
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

int adp_net_list(char names[][33], char cur[33], void *user) {
  xSemaphoreTake(mu, portMAX_DELAY);
  for (int i = 0; i < nets.n; i++) strlcpy(names[i], nets.e[i].ssid, 33);
  strlcpy(cur, (xEventGroupGetBits(ev) & CONNECTED) ? current : "", 33);
  int n = nets.n;
  xSemaphoreGive(mu);
  return n;
}
