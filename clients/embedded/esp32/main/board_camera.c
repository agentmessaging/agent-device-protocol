// camera.snapshot for the Seeed XIAO ESP32-S3 Sense (OV2640 or OV3660 on the Sense board).
// The camera runs only while the user LED is on: the LED goes on, the camera starts, one JPEG is taken,
// the camera stops, and the LED stays on three more seconds (protocol/capabilities.md, visible capture).
#include <stdlib.h>
#include <string.h>

#include "esp_camera.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define WARMUP_FRAMES 3  // auto exposure settles over the first frames after the camera starts

static const char *TAG = "camera";
void adp_sign_init(void);  // board_sign.c
void adp_sign_hold(void);
void adp_sign_release(int linger_ms);

static esp_err_t start(void) {
  camera_config_t c = {
      .pin_pwdn = -1, .pin_reset = -1, .pin_xclk = 10, .pin_sccb_sda = 40, .pin_sccb_scl = 39,
      .pin_d7 = 48, .pin_d6 = 11, .pin_d5 = 12, .pin_d4 = 14, .pin_d3 = 16, .pin_d2 = 18, .pin_d1 = 17, .pin_d0 = 15,
      .pin_vsync = 38, .pin_href = 47, .pin_pclk = 13,
      .xclk_freq_hz = 20000000, .ledc_timer = LEDC_TIMER_0, .ledc_channel = LEDC_CHANNEL_0,
      .pixel_format = PIXFORMAT_JPEG, .frame_size = FRAMESIZE_XGA, .jpeg_quality = 12,
      .fb_count = 1, .fb_location = CAMERA_FB_IN_PSRAM, .grab_mode = CAMERA_GRAB_WHEN_EMPTY,
  };
  esp_err_t err = esp_camera_init(&c);
#if CONFIG_ADP_CAMERA_FLIP
  // The sensor turns the picture itself, before JPEG: a board mounted upside down in a toy (2026-11-23)
  sensor_t *s = err == ESP_OK ? esp_camera_sensor_get() : NULL;
  if (s) {
    s->set_vflip(s, 1);
    s->set_hmirror(s, 1);
  }
#endif
  return err;
}

// At boot: the LED pin and timer, and one start and stop of the camera to see that it is there.
int adp_board_camera_init(void) {
  adp_sign_init();
  adp_sign_hold();  // the probe starts the sensor, so it is a capture too and shows the sign
  esp_err_t err = start();
  if (err == ESP_OK) esp_camera_deinit();
  adp_sign_release(3000);
  if (err != ESP_OK) ESP_LOGE(TAG, "No camera (%s): camera.snapshot is not offered", esp_err_to_name(err));
  return err == ESP_OK ? 0 : -1;
}

int adp_board_snapshot(unsigned char **jpeg, size_t *len, void *user) {
  (void)user;
  adp_sign_hold();  // the sign is lit before the sensor starts
  int rc = -1;
  if (start() == ESP_OK) {
    camera_fb_t *fb = NULL;
    for (int i = 0; i <= WARMUP_FRAMES; i++) {
      if (fb) esp_camera_fb_return(fb);
      fb = esp_camera_fb_get();
    }
    if (fb && fb->format == PIXFORMAT_JPEG && (*jpeg = malloc(fb->len))) {
      memcpy(*jpeg, fb->buf, fb->len);
      *len = fb->len;
      rc = 0;
    }
    if (fb) esp_camera_fb_return(fb);
    esp_camera_deinit();
  }
  adp_sign_release(3000);  // at least three seconds after the picture
  if (rc) ESP_LOGW(TAG, "Snapshot failed");
  return rc;
}
