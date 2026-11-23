// Hardware doctor for the Seeed XIAO ESP32-S3 Sense: one pass over each part at boot, printed to the
// USB console as "DOCTOR <part> PASS|FAIL|INFO <detail>". The microphone and camera run only while the
// user LED is on (protocol/capabilities.md, visible capture). Nothing it records leaves the board.
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "driver/gpio.h"
#include "driver/i2s_pdm.h"
#include "driver/i2s_std.h"
#include "esp_chip_info.h"
#include "esp_flash.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_psram.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "lwip/sockets.h"

#define RATE 16000
#define TONE_HZ 1000

static int passed, failed;

static void report(const char *part, int ok, const char *fmt, ...) {
  char detail[160];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(detail, sizeof detail, fmt, ap);
  va_end(ap);
  if (ok > 0) passed++;
  if (ok == 0) failed++;
  printf("DOCTOR %-10s %s %s\n", part, ok > 0 ? "PASS" : ok == 0 ? "FAIL" : "INFO", detail);
}

void adp_sign_init(void);  // board_sign.c: the user LED, shared with the camera
void adp_sign_hold(void);
void adp_sign_release(int linger_ms);
static void led(bool on) { on ? adp_sign_hold() : adp_sign_release(0); }

// Power of one frequency in a block (Goertzel)
static double tone_power(const int16_t *s, int n, double hz) {
  double k = 2 * cos(2 * M_PI * hz / RATE), a = 0, b = 0;
  for (int i = 0; i < n; i++) {
    double c = s[i] + k * a - b;
    b = a;
    a = c;
  }
  return (a * a + b * b - k * a * b) / n;
}

static double rms_dbfs(const int16_t *s, int n, int *peak, bool *stuck) {
  double sum = 0;
  *peak = 0;
  *stuck = true;
  for (int i = 0; i < n; i++) {
    sum += (double)s[i] * s[i];
    if (abs(s[i]) > *peak) *peak = abs(s[i]);
    if (s[i] != s[0]) *stuck = false;
  }
  return 20 * log10(sqrt(sum / n) / 32768 + 1e-9);
}

typedef struct {
  i2s_chan_handle_t tx;
  int ms;
} tone_job_t;

static void play_tone(void *arg) {
  tone_job_t *job = arg;
  static int16_t buf[256];
  int total = RATE * job->ms / 1000;
  for (int done = 0; done < total; done += 256) {
    for (int i = 0; i < 256; i++) buf[i] = (int16_t)(8000 * sin(2 * M_PI * TONE_HZ * (done + i) / RATE));
    size_t w;
    i2s_channel_write(job->tx, buf, sizeof buf, &w, 1000);
  }
  job->ms = 0;
  vTaskDelete(NULL);
}

static int record(i2s_chan_handle_t rx, int16_t *s, int n) {
  size_t got = 0, r;
  while (got < n * sizeof *s) {
    if (i2s_channel_read(rx, (char *)s + got, n * sizeof *s - got, &r, 2000) != ESP_OK) return -1;
    got += r;
  }
  return 0;
}

static void audio(void) {
  i2s_chan_handle_t rx = NULL, tx = NULL;
  i2s_chan_config_t rc = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);  // PDM input is I2S0 only
  i2s_pdm_rx_config_t pc = {
      .clk_cfg = I2S_PDM_RX_CLK_DEFAULT_CONFIG(RATE),
      .slot_cfg = I2S_PDM_RX_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
      .gpio_cfg = {.clk = GPIO_NUM_42, .din = GPIO_NUM_41},
  };
  if (i2s_new_channel(&rc, NULL, &rx) || i2s_channel_init_pdm_rx_mode(rx, &pc) || i2s_channel_enable(rx)) {
    report("microphone", 0, "PDM input did not start");
    return;
  }
  i2s_chan_config_t tc = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_1, I2S_ROLE_MASTER);
  tc.auto_clear = true;
  i2s_std_config_t sc = {
      .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(RATE),
      .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
      .gpio_cfg = {.mclk = I2S_GPIO_UNUSED, .bclk = CONFIG_ADP_SPEAKER_BCLK, .ws = CONFIG_ADP_SPEAKER_WS,
                   .dout = CONFIG_ADP_SPEAKER_DOUT, .din = I2S_GPIO_UNUSED},
  };
  sc.slot_cfg.slot_mask = I2S_STD_SLOT_BOTH;  // the MAX98357A with SD unconnected plays (L+R)/2
  bool speaker = !i2s_new_channel(&tc, &tx, NULL) && !i2s_channel_init_std_mode(tx, &sc) && !i2s_channel_enable(tx);

  int n = RATE;  // one second
  int16_t *quiet = heap_caps_malloc(n * 2, MALLOC_CAP_SPIRAM), *loud = heap_caps_malloc(n * 2, MALLOC_CAP_SPIRAM);
  led(true);  // the sign is lit before the microphone records
  bool ok = quiet && loud && !record(rx, quiet, RATE / 4) && !record(rx, quiet, n);  // the first 250 ms settle
  int peak;
  bool stuck;
  if (!ok) {
    report("microphone", 0, "no samples from GPIO41/42");
  } else {
    double db = rms_dbfs(quiet, n, &peak, &stuck);
    report("microphone", !stuck && peak > 0, "room level %.1f dBFS, peak %d%s", db, peak, stuck ? " (stuck: every sample equal)" : "");
  }
  if (!speaker) {
    report("speaker", 0, "I2S output on BCLK %d, WS %d, DOUT %d did not start", CONFIG_ADP_SPEAKER_BCLK,
           CONFIG_ADP_SPEAKER_WS, CONFIG_ADP_SPEAKER_DOUT);
  } else if (ok) {
    static tone_job_t job;
    job = (tone_job_t){tx, 1500};
    xTaskCreate(play_tone, "doctor-tone", 4096, &job, 5, NULL);
    vTaskDelay(pdMS_TO_TICKS(200));
    if (record(rx, loud, n)) {
      report("speaker", 0, "microphone stopped during the tone");
    } else {
      double before = tone_power(quiet, n, TONE_HZ), during = tone_power(loud, n, TONE_HZ);
      double gain = 10 * log10((during + 1) / (before + 1));
      // The microphone hears the 1 kHz tone: the speaker, the amplifier and its wiring work
      report("speaker", gain > 20, "1 kHz tone %.1f dB above the room at the microphone%s", gain,
             gain > 20 ? "" : " (check VIN, GND, BCLK, LRC, DIN)");
    }
    while (job.ms) vTaskDelay(pdMS_TO_TICKS(50));
  }
  led(false);
  free(quiet);
  free(loud);
  if (tx) {
    i2s_channel_disable(tx);
    i2s_del_channel(tx);
  }
  i2s_channel_disable(rx);
  i2s_del_channel(rx);
}

static void network(EventGroupHandle_t wifi, const char *url) {
  if (!(xEventGroupWaitBits(wifi, 1, pdFALSE, pdTRUE, pdMS_TO_TICKS(20000)) & 1)) {
    report("wifi", 0, "no address after 20 s (antenna attached? network %s)", CONFIG_ADP_WIFI_SSID);
    return;
  }
  wifi_ap_record_t ap;
  esp_netif_ip_info_t ip;
  esp_wifi_sta_get_ap_info(&ap);
  esp_netif_get_ip_info(esp_netif_get_handle_from_ifkey("WIFI_STA_DEF"), &ip);
  report("wifi", 1, "%s, " IPSTR ", signal %d dBm%s", CONFIG_ADP_WIFI_SSID, IP2STR(&ip.ip), ap.rssi,
         ap.rssi < -75 ? " (weak)" : "");

  char host[16] = {0};
  int port = 0;
  if (sscanf(url, "ws://%15[0-9.]:%d", host, &port) != 2) {
    report("controller", 0, "address %s is not ws://IPV4:PORT", url);
    return;
  }
  int s = socket(AF_INET, SOCK_STREAM, 0);
  struct sockaddr_in to = {.sin_family = AF_INET, .sin_port = htons(port)};
  inet_pton(AF_INET, host, &to.sin_addr);
  struct timeval tv = {.tv_sec = 3};
  setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof tv);
  int rc = connect(s, (struct sockaddr *)&to, sizeof to);
  close(s);
  report("controller", rc == 0, "%s:%d %s", host, port, rc == 0 ? "accepts connections" : "does not answer (host off or address changed?)");
}

void adp_board_doctor(EventGroupHandle_t wifi, const char *url) {
  adp_sign_init();
  while (esp_timer_get_time() < 4000000) vTaskDelay(pdMS_TO_TICKS(100));  // the camera probe's sign ends first
  printf("DOCTOR start\n");

  esp_chip_info_t chip;
  esp_chip_info(&chip);
  uint32_t flash = 0;
  esp_flash_get_size(NULL, &flash);
  report("chip", 1, "%s rev %d.%d, %d cores, flash %lu MB", CONFIG_IDF_TARGET, chip.revision / 100, chip.revision % 100,
         chip.cores, (unsigned long)(flash >> 20));
  size_t psram = esp_psram_get_size();
  report("psram", psram >= 8 << 20, "%u KB, %u KB free; internal RAM %u KB free", (unsigned)(psram >> 10),
         (unsigned)(heap_caps_get_free_size(MALLOC_CAP_SPIRAM) >> 10),
         (unsigned)(heap_caps_get_free_size(MALLOC_CAP_INTERNAL) >> 10));

  printf("DOCTOR led        WATCH three blinks now\n");
  for (int i = 0; i < 3; i++) {
    led(true);
    vTaskDelay(pdMS_TO_TICKS(300));
    led(false);
    vTaskDelay(pdMS_TO_TICKS(300));
  }
  report("led", -1, "blinked three times: a person must confirm it");

  network(wifi, url);
  audio();
#if CONFIG_ADP_CAMERA
  extern int adp_board_snapshot(unsigned char **jpeg, size_t *len, void *user);
  unsigned char *jpeg = NULL;
  size_t len = 0;
  int64_t t = esp_timer_get_time();
  int rc = adp_board_snapshot(&jpeg, &len, NULL);
  report("camera", !rc && len > 3 && jpeg[0] == 0xFF && jpeg[1] == 0xD8, "%u byte JPEG in %d ms", (unsigned)len,
         (int)((esp_timer_get_time() - t) / 1000));
  free(jpeg);
#else
  report("camera", -1, "not built (ADP_CAMERA off)");
#endif
  printf("DOCTOR done: %d pass, %d fail\n", passed, failed);
}
