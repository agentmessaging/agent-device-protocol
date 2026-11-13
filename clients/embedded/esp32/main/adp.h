// ADP device core: the outbound connection profile (protocol/reverse.md) as frame in, frame out.
// No I/O here, so the same file runs on the ESP32 and in the host test.
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define ADP_HEX 49            // 24 random bytes as 48 lowercase hex characters, plus NUL
#define ADP_KEY 44            // unpadded base64url of a 32-byte Ed25519 public key, plus NUL
#define ADP_CHALLENGES 8      // outstanding request challenges; the spec allows up to 512
#define ADP_MAX_FRAME 16384   // largest frame handled; display.text needs about 6 KiB

typedef struct {
  unsigned char sk[64];  // libsodium secret key: seed then public key
  char key[ADP_KEY];
  unsigned char owner_pk[32];
  char owner_key[ADP_KEY];
  char agent[256];
  char boot_id[ADP_HEX];
  char revision[ADP_HEX];
  const char *platform;
  // display.text, advertised only when set. Returns 0 when shown.
  int (*show_text)(const char *text, void *user);
  void *user;
  // session
  int state;  // 0 waiting for hello, 1 connect sent, 2 authenticated
  char hs_id[ADP_HEX], hs_challenge[ADP_HEX], hs_device_challenge[ADP_HEX];
  struct {
    char value[ADP_HEX];
    int64_t until;
  } challenges[ADP_CHALLENGES];
} adp_t;

// Returns 0, or -1 for a bad owner key or agent address. Needs sodium_init() first.
int adp_init(adp_t *adp, const unsigned char sk[64], const char *owner_key, const char *agent,
             const char *platform);
// Call before every new connection: a reconnect is a new handshake.
void adp_new_session(adp_t *adp);
// Handles one text frame. *out is NULL or a malloc'd frame to send. Returns -1 when the
// connection must be closed, as the SDK's DeviceConnection does on any invalid message.
int adp_handle(adp_t *adp, const char *frame, size_t len, int64_t now_ms, char **out);
// Signs body bytes as {"body","signature"}. Returns a malloc'd string or NULL.
char *adp_seal(const unsigned char sk[64], const char *body, size_t len);
// Unpadded base64url of the public key in sk.
void adp_public_key(const unsigned char sk[64], char out[ADP_KEY]);
