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
  // S003: connect through /v1/secure and refuse anything that is not encrypted
  bool secure;
  // session
  int state;  // 0 waiting for hello, 1 connect sent, 2 authenticated
  char hs_id[ADP_HEX], hs_challenge[ADP_HEX], hs_device_challenge[ADP_HEX];
  struct {
    char value[ADP_HEX];
    int64_t until;
  } challenges[ADP_CHALLENGES];
  // S003 session: 0 waiting for secure.hello, 1 encrypted
  int sec_state;
  unsigned char sec_tx[32], sec_rx[32];  // device-to-controller and controller-to-device keys
  uint64_t sec_tx_n, sec_rx_n;            // implicit per-direction message counters
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
// One WebSocket message in, text or binary. Without adp->secure it is adp_handle(). With it, the first
// message must be the text secure.hello and every later one binary (S003). *out is NULL or a malloc'd
// message to send, with its length and kind. Returns -1 when the connection must be closed.
int adp_receive(adp_t *adp, const unsigned char *data, size_t len, bool binary, int64_t now_ms,
                unsigned char **out, size_t *out_len, bool *out_binary);
// S003 key schedule: both direction keys from the X25519 result and the decoded hello and accept bodies.
void adp_secure_keys(const unsigned char shared[32], const unsigned char *hello, size_t hello_len,
                     const unsigned char *accept, size_t accept_len, unsigned char controller_to_device[32],
                     unsigned char device_to_controller[32]);
// Encrypts one message with the next sending counter: ciphertext then 16-byte tag, malloc'd.
int adp_secure_seal(adp_t *adp, const unsigned char *in, size_t len, unsigned char **out, size_t *out_len);
