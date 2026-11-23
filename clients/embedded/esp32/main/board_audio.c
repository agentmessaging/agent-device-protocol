// Talk control and speaker for the Seeed XIAO ESP32-S3 Sense (F008).
// Microphone: the Sense board's PDM microphone (clock GPIO42, data GPIO41) on I2S0, powered only while a
// person talks, always under the capture sign. Talk control: press the button (BOOT by default) and speak;
// recording ends after one second of quiet, at a second press, or at 20 seconds, and the clip goes to the
// controller as one audio event (protocol/reverse.md). Nothing is sent if nobody speaks within 5 seconds.
// Speaker: a MAX98357A on I2S1. speaker.play stops, with played:false, when a person starts talking.
#include <math.h>
#include <stdlib.h>
#include <string.h>

#include "driver/gpio.h"
#include "driver/i2s_pdm.h"
#include "driver/i2s_std.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

void adp_sign_init(void);  // board_sign.c
void adp_sign_hold(void);
void adp_sign_release(int linger_ms);

#define RATE 16000
#define FRAME 480  // 30 ms
#define MAX_SAMPLES (RATE * 20 - FRAME)  // under the audio event's 20 seconds
#define QUIET_END_MS 1000
#define NOBODY_MS 5000
#define STALE_MS 10000  // a clip the controller could not take in time is dropped, never replayed

static const char *TAG = "audio";
static i2s_chan_handle_t mic, spk;
static volatile bool talking, stop_play, talk_requested;
static portMUX_TYPE lock = portMUX_INITIALIZER_UNLOCKED;
static unsigned char *clip;
static size_t clip_len;
static int64_t clip_at;

static void wav_header(unsigned char *h, uint32_t samples) {
  uint32_t data = samples * 2, v;
  memcpy(h, "RIFF", 4);
  v = 36 + data;
  memcpy(h + 4, &v, 4);
  memcpy(h + 8, "WAVEfmt ", 8);
  v = 16;
  memcpy(h + 16, &v, 4);
  uint16_t fmt[] = {1, 1};  // PCM, mono
  memcpy(h + 20, fmt, 4);
  v = RATE;
  memcpy(h + 24, &v, 4);
  v = RATE * 2;
  memcpy(h + 28, &v, 4);
  uint16_t align[] = {2, 16};
  memcpy(h + 32, align, 4);
  memcpy(h + 36, "data", 4);
  memcpy(h + 40, &data, 4);
}

static float frame_db(const int16_t *s, int n) {
  double sum = 0;
  for (int i = 0; i < n; i++) sum += (double)s[i] * s[i];
  return 20 * log10(sqrt(sum / n) / 32768 + 1e-9);
}

static bool button_down(void) { return gpio_get_level(CONFIG_ADP_TALK_GPIO) == 0; }

// Records one utterance under the sign. Returns the number of samples kept in pcm, 0 when nobody spoke.
static int record(int16_t *pcm) {
  talking = true;
  stop_play = true;  // the microphone must not pick up the agent
  adp_sign_hold();
  esp_err_t err = i2s_channel_enable(mic);
  if (err) ESP_LOGW(TAG, "Microphone did not start: %s", esp_err_to_name(err));
  int16_t frame[FRAME];
  size_t got;
  for (int i = 0; i < 12; i++) i2s_channel_read(mic, frame, sizeof frame, &got, 200);  // the PDM start click lasts ~300 ms
  float floor_db = 0;
  int n = 0, quiet_ms = 0, waited_ms = 0;
  bool spoke = false, released = false;
  while (n < MAX_SAMPLES) {
    if ((err = i2s_channel_read(mic, pcm + n, FRAME * 2, &got, 200)) || got != FRAME * 2) {
      ESP_LOGW(TAG, "Microphone read failed after %d ms: %s, %u bytes", n * 1000 / RATE, esp_err_to_name(err), (unsigned)got);
      break;
    }
    float db = frame_db(pcm + n, FRAME);
    // The quiet level starts at the first 300 ms after the button and then follows the room only between
    // words, down faster than up: one very quiet frame must not drag it down, and speech must never raise
    // it, or the room becomes "speech" (records all 20 s) or a long sentence becomes "quiet" (cut off).
    bool speech = n >= 10 * FRAME && db > floor_db + 10 && db > -60;
    if (n < 10 * FRAME) floor_db = n == 0 ? db : floor_db + (db - floor_db) / (n / FRAME + 1);
    else if (!speech) floor_db += (db < floor_db ? 0.1f : 0.02f) * (db - floor_db);
    n += FRAME;
    if (!button_down()) released = true;
    if (released && button_down()) break;  // a second press ends it
    if (speech) spoke = true, quiet_ms = 0;
    else if (spoke && (quiet_ms += 30) >= QUIET_END_MS) break;
    if (!spoke && (waited_ms += 30) >= NOBODY_MS) break;
  }
  i2s_channel_disable(mic);
  adp_sign_release(500);
  ESP_LOGI(TAG, "Talk: %d ms heard, speech %s, room %.1f dBFS", n * 1000 / RATE, spoke ? "yes" : "no", floor_db);
  talking = false;
  if (!spoke) return 0;
  // The PDM level is low (a quiet room is about -44 dBFS): bring the loudest sample near -3 dBFS
  int peak = 1;
  for (int i = 0; i < n; i++) peak = abs(pcm[i]) > peak ? abs(pcm[i]) : peak;
  float gain = fminf(16.0f, 23000.0f / peak);
  for (int i = 0; i < n; i++) pcm[i] = (int16_t)fmaxf(-32768, fminf(32767, pcm[i] * gain));
  return n;
}

static void talk_task(void *arg) {
  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(20));
    if (!button_down() && !talk_requested) continue;
    talk_requested = false;
    unsigned char *wav = heap_caps_malloc(44 + MAX_SAMPLES * 2, MALLOC_CAP_SPIRAM);
    if (!wav) continue;
    ESP_LOGI(TAG, "Talk: recording");
    int n = record((int16_t *)(wav + 44));
    if (n) {
      wav_header(wav, n);
      portENTER_CRITICAL(&lock);
      unsigned char *old = clip;
      clip = wav;
      clip_len = 44 + n * 2;
      clip_at = esp_timer_get_time();
      portEXIT_CRITICAL(&lock);
      free(old);
      ESP_LOGI(TAG, "Talk: %d ms recorded", n * 1000 / RATE);
    } else {
      free(wav);
      ESP_LOGI(TAG, "Talk: nobody spoke, nothing sent");
    }
    while (button_down()) vTaskDelay(pdMS_TO_TICKS(20));
  }
}

// A test press from the debug console (board_debug.c)
void adp_board_talk_now(void) { talk_requested = true; }

// The latest clip for the controller, once. Returns false when there is none, or it waited too long.
bool adp_board_take_talk(unsigned char **wav, size_t *len) {
  portENTER_CRITICAL(&lock);
  unsigned char *c = clip;
  size_t l = clip_len;
  bool fresh = c && esp_timer_get_time() - clip_at < STALE_MS * 1000LL;
  clip = NULL;
  portEXIT_CRITICAL(&lock);
  if (c && !fresh) {
    ESP_LOGW(TAG, "Talk: the controller was not ready; the clip is dropped");
    free(c);
  }
  if (!fresh) return false;
  *wav = c;
  *len = l;
  return true;
}

static const unsigned char *chunk(const unsigned char *wav, size_t len, const char *id, uint32_t *size) {
  for (size_t at = 12; at + 8 <= len;) {
    uint32_t n;
    memcpy(&n, wav + at + 4, 4);
    if (n > len - at - 8) return NULL;
    if (!memcmp(wav + at, id, 4)) {
      *size = n;
      return wav + at + 8;
    }
    at += 8 + n + (n & 1);
  }
  return NULL;
}

int adp_board_play(const unsigned char *wav, size_t len, bool *played, void *user) {
  (void)user;
  *played = false;
  if (talking) return 0;
  uint32_t fmt_len, data_len;
  const unsigned char *fmt = chunk(wav, len, "fmt ", &fmt_len), *data = chunk(wav, len, "data", &data_len);
  uint16_t format, channels, bits;
  uint32_t rate;
  if (!fmt || !data || fmt_len < 16) return -1;
  memcpy(&format, fmt, 2);
  memcpy(&channels, fmt + 2, 2);
  memcpy(&rate, fmt + 4, 4);
  memcpy(&bits, fmt + 14, 2);
  if (format != 1 || bits != 16 || channels < 1 || channels > 2 || rate < 8000 || rate > 48000) {
    ESP_LOGW(TAG, "speaker.play: only 16-bit PCM, 1 or 2 channels, 8 to 48 kHz");
    return -1;
  }
  i2s_std_clk_config_t clk = I2S_STD_CLK_DEFAULT_CONFIG(rate);
  i2s_std_slot_config_t slot = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(
      I2S_DATA_BIT_WIDTH_16BIT, channels == 2 ? I2S_SLOT_MODE_STEREO : I2S_SLOT_MODE_MONO);
  slot.slot_mask = I2S_STD_SLOT_BOTH;  // the MAX98357A with SD unconnected plays (L+R)/2
  if (i2s_channel_reconfig_std_clock(spk, &clk) || i2s_channel_reconfig_std_slot(spk, &slot) || i2s_channel_enable(spk))
    return -1;
  stop_play = false;
  bool stopped = false;
  for (uint32_t at = 0; at < data_len; at += 2048) {
    if (stop_play) {
      stopped = true;
      break;
    }
    size_t w, n = data_len - at < 2048 ? data_len - at : 2048;
    i2s_channel_write(spk, data + at, n, &w, 1000);
  }
  static const int16_t silence[256];
  size_t w;
  i2s_channel_write(spk, silence, sizeof silence, &w, 100);
  i2s_channel_disable(spk);
  *played = !stopped;
  return 0;
}

int adp_board_audio_init(bool microphone, bool speaker) {
  adp_sign_init();
  if (speaker) {
    i2s_chan_config_t tc = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_1, I2S_ROLE_MASTER);
    tc.auto_clear = true;
    i2s_std_config_t sc = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(RATE),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
        .gpio_cfg = {.mclk = I2S_GPIO_UNUSED, .bclk = CONFIG_ADP_SPEAKER_BCLK, .ws = CONFIG_ADP_SPEAKER_WS,
                     .dout = CONFIG_ADP_SPEAKER_DOUT, .din = I2S_GPIO_UNUSED},
    };
    if (i2s_new_channel(&tc, &spk, NULL) || i2s_channel_init_std_mode(spk, &sc)) {
      ESP_LOGE(TAG, "No speaker output: speaker.play is not offered");
      return -1;
    }
  }
  if (microphone) {
    i2s_chan_config_t rc = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);  // PDM input is I2S0 only
    i2s_pdm_rx_config_t pc = {
        .clk_cfg = I2S_PDM_RX_CLK_DEFAULT_CONFIG(RATE),
        .slot_cfg = I2S_PDM_RX_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
        .gpio_cfg = {.clk = GPIO_NUM_42, .din = GPIO_NUM_41},
    };
    if (i2s_new_channel(&rc, NULL, &mic) || i2s_channel_init_pdm_rx_mode(mic, &pc)) {
      ESP_LOGE(TAG, "No microphone: the talk control is off");
      return -1;
    }
    gpio_config_t b = {.pin_bit_mask = 1ULL << CONFIG_ADP_TALK_GPIO, .mode = GPIO_MODE_INPUT, .pull_up_en = 1};
    gpio_config(&b);
    xTaskCreate(talk_task, "talk", 4096, NULL, 5, NULL);
  }
  return 0;
}
