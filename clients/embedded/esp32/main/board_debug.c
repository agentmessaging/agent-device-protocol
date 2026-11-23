// Debug build only (ADP_DOCTOR): every log line also goes over Wi-Fi as UDP to the owner's log host, and
// the USB console takes test commands, so a test needs no one at the board. Commands come only from the
// USB cable (physical access): "talk" starts a recording as a talk-button press does, under the sign.
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#include "driver/usb_serial_jtag.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/sockets.h"
#include "sdkconfig.h"

void adp_board_talk_now(void);  // board_audio.c

static int sock = -1;
static struct sockaddr_in to;
static vprintf_like_t original;

static int log_both(const char *fmt, va_list ap) {
  va_list copy;
  va_copy(copy, ap);
  int n = original(fmt, ap);
  if (sock >= 0) {
    char line[256];
    int len = vsnprintf(line, sizeof line, fmt, copy);
    if (len > 0) sendto(sock, line, len < (int)sizeof line ? len : (int)sizeof line - 1, MSG_DONTWAIT, (struct sockaddr *)&to, sizeof to);
  }
  va_end(copy);
  return n;
}

static void commands(void *arg) {
  char cmd[32];
  int n = 0;
  for (;;) {
    uint8_t c;
    if (usb_serial_jtag_read_bytes(&c, 1, portMAX_DELAY) != 1) continue;
    if (c != '\n' && c != '\r') {
      if (n < (int)sizeof cmd - 1) cmd[n++] = (char)c;
      continue;
    }
    cmd[n] = 0;
    n = 0;
    if (!strcmp(cmd, "talk")) {
      ESP_LOGI("debug", "Console: talk");
      adp_board_talk_now();
    } else if (*cmd) {
      ESP_LOGW("debug", "Console: unknown command '%s' (talk)", cmd);
    }
  }
}

// After Wi-Fi is up
void adp_board_debug_start(void) {
  if (*CONFIG_ADP_LOG_HOST) {
    char host[16] = {0};
    int port = 0;
    if (sscanf(CONFIG_ADP_LOG_HOST, "%15[0-9.]:%d", host, &port) == 2 && inet_pton(AF_INET, host, &to.sin_addr) == 1) {
      to.sin_family = AF_INET;
      to.sin_port = htons(port);
      sock = socket(AF_INET, SOCK_DGRAM, 0);
      original = esp_log_set_vprintf(log_both);
      ESP_LOGI("debug", "Logs also go to %s", CONFIG_ADP_LOG_HOST);
    } else {
      ESP_LOGW("debug", "ADP_LOG_HOST must be IPV4:PORT");
    }
  }
  usb_serial_jtag_driver_config_t c = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
  if (usb_serial_jtag_driver_install(&c) == ESP_OK) xTaskCreate(commands, "console", 3072, NULL, 4, NULL);
}
