// Talk control and speaker for the Seeed XIAO ESP32-S3 Sense (F008).
// Microphone: the Sense board's PDM microphone (clock GPIO42, data GPIO41) on I2S0, powered only while a
// person talks, always under the capture sign. Talk control: press the button (BOOT by default) and speak;
// recording ends after one second of quiet, at a second press, or at 20 seconds, and the clip goes to the
// controller as one audio event (protocol/reverse.md). Nothing is sent if nobody speaks within 5 seconds.
// Speaker: a MAX98357A on I2S1. speaker.play stops, with played:false, when a person starts talking.
// Listening (ADP_LISTEN, S004): the microphone runs all the time through the wake phrase detector (wake.cc)
// under the dim sign. The phrase starts the same recording as the button. After the agent's speech ends,
// the board records up to 8 seconds for an answer. No echo cancellation: detection pauses while it plays.
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
#include "vad.h"

void adp_sign_init(void);  // board_sign.c
void adp_sign_hold(void);
void adp_sign_release(int linger_ms);
void adp_sign_listening(bool on);
bool adp_wake_init(void);  // wake.cc
void adp_wake_reset(void);
bool adp_wake_feed(const int16_t *s, int n);
int adp_wake_peak(void);

#define RATE 16000
#define FRAME 480  // 30 ms
#define MAX_SAMPLES (RATE * 20 - FRAME)  // under the audio event's 20 seconds
#define NOBODY_MS 5000
#define STALE_MS 10000  // a clip the controller could not take in time is dropped, never replayed
#define FOLLOWUP_MS 8000
#define FOLLOWUP_DELAY_US 700000  // the agent's next sentence usually arrives sooner; then it plays instead

static const char *TAG = "audio";
static i2s_chan_handle_t mic, spk;
static volatile bool talking, stop_play, talk_requested, playing, listening, cancel_followup;
static volatile int64_t followup_at;  // when to open the answer window, 0 for none
static bool mic_on;
static volatile int hear_ms;  // debug: record this long while the speaker keeps playing
static volatile int volume = CONFIG_ADP_SPEAKER_VOLUME;  // percent; the debug console can change it
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

static bool button_down(void) { return gpio_get_level(CONFIG_ADP_TALK_GPIO) == 0; }

// Records one utterance under the sign. Returns the number of samples kept in pcm, 0 when nobody spoke.
// A follow-up recording gives way to the agent's next sentence until the person starts talking.
static int record(int16_t *pcm, int nobody_ms, bool followup, const adp_vad_t *room) {
  int fixed = hear_ms;
  hear_ms = 0;
  talking = !fixed;
  stop_play = !fixed;  // the microphone must not pick up the agent (except in the debug speaker check)
  cancel_followup = false;
  adp_sign_hold();
  esp_err_t err = ESP_OK;
  size_t got;
  if (!mic_on) {
    if ((err = i2s_channel_enable(mic))) ESP_LOGW(TAG, "Microphone did not start: %s", esp_err_to_name(err));
    int16_t frame[FRAME];
    for (int i = 0; i < 12; i++) i2s_channel_read(mic, frame, sizeof frame, &got, 200);  // the PDM start click lasts ~300 ms
  }
  adp_vad_t vad;
  if (room) {
    vad = *room;  // the room level from listening: speech right after the phrase cannot count as the room
    adp_vad_restart(&vad);
  } else {
    adp_vad_init(&vad);
  }
  int n = 0, end = ADP_VAD_GOING;
  bool released = false;
  while (n < MAX_SAMPLES && (fixed ? n < fixed * (RATE / 1000) : end == ADP_VAD_GOING)) {
    if ((err = i2s_channel_read(mic, pcm + n, FRAME * 2, &got, 200)) || got != FRAME * 2) {
      ESP_LOGW(TAG, "Microphone read failed after %d ms: %s, %u bytes", n * 1000 / RATE, esp_err_to_name(err), (unsigned)got);
      break;
    }
    adp_vad_highpass(&vad, pcm + n, FRAME);
    end = adp_vad_frame(&vad, pcm + n, nobody_ms);
    n += FRAME;
    if (followup && cancel_followup && !vad.spoke) break;
    if (!button_down()) released = true;
    if (released && button_down()) break;  // a second press ends it
  }
  bool spoke = vad.spoke || fixed;
  float floor_db = vad.quiet_db;
  if (!mic_on) i2s_channel_disable(mic);
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
  bool reset = true;
  static adp_vad_t room;
  adp_vad_init(&room);
  if (listening) {
    mic_on = i2s_channel_enable(mic) == ESP_OK;
    adp_sign_listening(mic_on);
    if (!mic_on) ESP_LOGE(TAG, "Microphone did not start: not listening");
  }
  for (;;) {
    int nobody = NOBODY_MS;
    bool go = false, followup = false;
    if (mic_on) {
      int16_t frame[FRAME];
      size_t got;
      if (i2s_channel_read(mic, frame, sizeof frame, &got, 200) || got != sizeof frame) continue;
      if (playing) {
        reset = true;  // it would hear the agent
        continue;
      }
      if (reset) adp_wake_reset();
      reset = false;
      // The detector hears what a recording sends: the PDM level is about 24 dB below the clips the model
      // was checked on, so it gets the same low cut and the recording's maximum gain
      static adp_vad_t cut;
      int16_t loud[FRAME];
      memcpy(loud, frame, sizeof loud);
      adp_vad_highpass(&cut, loud, FRAME);
      for (int i = 0; i < FRAME; i++) loud[i] = (int16_t)(loud[i] > 2047 ? 32767 : loud[i] < -2048 ? -32768 : loud[i] * 16);
      go = adp_wake_feed(loud, FRAME);
#if CONFIG_ADP_DOCTOR
      static int frames;
      if (++frames % 100 == 0) {  // every 3 s: how close the detector came, never audio
        int p = adp_wake_peak();
        if (p >= 5) ESP_LOGI(TAG, "Wake: best score %d%% (cutoff %d%%)", p, CONFIG_ADP_WAKE_CUTOFF);
      }
#endif
      adp_vad_highpass(&room, frame, FRAME);
      adp_vad_frame(&room, frame, 0);
      int64_t at = followup_at;
      if (!go && at && esp_timer_get_time() >= at) {
        followup_at = 0;
        go = followup = true;
        nobody = FOLLOWUP_MS;
        ESP_LOGI(TAG, "Talk: waiting for an answer");
      }
    } else {
      vTaskDelay(pdMS_TO_TICKS(20));
    }
    if (!go && !button_down() && !talk_requested) continue;
    talk_requested = false;
    followup_at = 0;
    reset = true;
    unsigned char *wav = heap_caps_malloc(44 + MAX_SAMPLES * 2, MALLOC_CAP_SPIRAM);
    if (!wav) continue;
    ESP_LOGI(TAG, "Talk: recording");
    int n = record((int16_t *)(wav + 44), nobody, followup, mic_on ? &room : NULL);
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

bool adp_board_listening(void) { return listening; }

// A test press from the debug console (board_debug.c)
void adp_board_talk_now(void) { talk_requested = true; }
void adp_board_volume(int percent) { volume = percent < 1 ? 1 : percent > 100 ? 100 : percent; }
void adp_board_hear_now(int ms) {
  hear_ms = ms;
  talk_requested = true;
}

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
  followup_at = 0;
  if (talking) {
    cancel_followup = true;  // an answer window nobody has spoken in yet gives way to the agent
    for (int i = 0; talking && i < 20; i++) vTaskDelay(pdMS_TO_TICKS(10));
    if (talking) return 0;
  }
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
  // Stereo frames with each sample on both channels, as Meta's Muse firmware drives a MAX98357A (Waveshare
  // S3 1.9): the amplifier's channel strap (SD) then never changes what plays. Volume: speech at full scale
  // through the amplifier's 9 dB gain was noise on a USB-powered XIAO with jumper wires; 12% was clean.
  i2s_std_slot_config_t slot = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO);
  if (i2s_channel_reconfig_std_clock(spk, &clk) || i2s_channel_reconfig_std_slot(spk, &slot) || i2s_channel_enable(spk))
    return -1;
  stop_play = false;
  playing = true;
  bool stopped = false;
  ESP_LOGI(TAG, "speaker.play: %u Hz, %u ch, %.1f s", (unsigned)rate, channels, data_len / 2.0f / channels / rate);
  static int16_t out[512];  // 256 stereo frames
  size_t samples = data_len / 2;
  for (size_t at = 0; at < samples && !stopped;) {
    if (stop_play) {
      stopped = true;
      break;
    }
    int k = 0;
    for (; k < 512 && at < samples; k += 2) {
      int16_t l, r;
      memcpy(&l, data + 2 * at++, 2);  // a WAV chunk may start at an odd offset
      r = l;
      if (channels == 2 && at < samples) memcpy(&r, data + 2 * at++, 2);
      l = l * volume / 100;
      r = r * volume / 100;
      out[k] = l;
      out[k + 1] = r;
    }
    size_t w;
    i2s_channel_write(spk, out, k * sizeof *out, &w, 1000);
  }
  static const int16_t silence[256];
  size_t w;
  i2s_channel_write(spk, silence, sizeof silence, &w, 100);
  i2s_channel_disable(spk);
  playing = false;
  *played = !stopped;
  if (listening && !stopped) followup_at = esp_timer_get_time() + FOLLOWUP_DELAY_US;
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
#if CONFIG_ADP_LISTEN
    listening = adp_wake_init();
    if (!listening) ESP_LOGE(TAG, "The wake phrase model did not load: talk button only");
#endif
    xTaskCreate(talk_task, "talk", listening ? 8192 : 4096, NULL, 5, NULL);
  }
  return 0;
}
