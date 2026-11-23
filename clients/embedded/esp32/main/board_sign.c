// The capture sign on the XIAO ESP32-S3 Sense user LED (GPIO21, on at low level), shared by the camera and
// the microphone (protocol/capabilities.md, visible capture). Each capture holds the sign while it runs and
// may keep it lit for a while after it ends; the LED is off only when no capture holds it and every linger
// has passed. Brightness comes from LEDC (timer 1, channel 1: the camera's clock uses timer 0, channel 0).
#include <stdbool.h>

#include "driver/ledc.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"

#define LED 21
#define FULL 255
#define DIM 12  // S004 listening sign: clearly different from the full recording sign

static portMUX_TYPE lock = portMUX_INITIALIZER_UNLOCKED;
static int holders;
static int64_t until;  // microseconds
static bool listening;
static esp_timer_handle_t timer;

static void apply(void) {
  int64_t now = esp_timer_get_time();
  portENTER_CRITICAL(&lock);
  int duty = holders > 0 || now < until ? FULL : listening ? DIM : 0;
  int64_t left = holders > 0 ? 0 : until - now;
  portEXIT_CRITICAL(&lock);
  // the pin is active low, so the output is inverted in the channel config
  ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1, duty);
  ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1);
  if (left > 0) {
    esp_timer_stop(timer);
    esp_timer_start_once(timer, left);
  }
}

static void expired(void *arg) { apply(); }

void adp_sign_init(void) {
  static bool done;
  if (done) return;
  done = true;
  ledc_timer_config_t t = {.speed_mode = LEDC_LOW_SPEED_MODE, .duty_resolution = LEDC_TIMER_8_BIT,
                           .timer_num = LEDC_TIMER_1, .freq_hz = 5000, .clk_cfg = LEDC_AUTO_CLK};
  ledc_timer_config(&t);
  ledc_channel_config_t c = {.gpio_num = LED, .speed_mode = LEDC_LOW_SPEED_MODE, .channel = LEDC_CHANNEL_1,
                             .timer_sel = LEDC_TIMER_1, .duty = 0, .flags.output_invert = 1};
  ledc_channel_config(&c);
  esp_timer_create_args_t a = {.callback = expired, .name = "capture-sign"};
  esp_timer_create(&a, &timer);
}

// Lit before it returns, so a capture that starts after this call is always under the sign
void adp_sign_hold(void) {
  portENTER_CRITICAL(&lock);
  holders++;
  portEXIT_CRITICAL(&lock);
  apply();
}

void adp_sign_release(int linger_ms) {
  int64_t end = esp_timer_get_time() + (int64_t)linger_ms * 1000;
  portENTER_CRITICAL(&lock);
  if (holders > 0) holders--;
  if (end > until) until = end;
  portEXIT_CRITICAL(&lock);
  apply();
}

void adp_sign_listening(bool on) {
  portENTER_CRITICAL(&lock);
  listening = on;
  portEXIT_CRITICAL(&lock);
  apply();
}
