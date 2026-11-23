// ADP device core: the outbound connection profile (protocol/reverse.md) as frame in, frame out.
// No I/O here, so the same file runs on the ESP32 and in the host test.
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define ADP_HEX 49            // 24 random bytes as 48 lowercase hex characters, plus NUL
#define ADP_KEY 44            // unpadded base64url of a 32-byte Ed25519 public key, plus NUL
#define ADP_CHALLENGES 8      // outstanding request challenges; the spec allows up to 512
#ifndef ADP_MAX_FRAME
#define ADP_MAX_FRAME 16384   // largest frame received; display.text needs about 6 KiB, speaker.play about 1 MiB
#endif
#define ADP_MAX_SNAPSHOT (1024 * 1024)  // largest JPEG sent (S003): fits the profile's 2,200,000-byte message
#define ADP_MAX_PLAY (384 * 1024)       // speaker.play WAV (capabilities.md)
#define ADP_MAX_AUDIO (640 * 1024)      // audio event WAV: 20 s of 16 kHz mono (reverse.md)

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
  // camera.snapshot, advertised only when set: the owner's camera grant and a working capture sign.
  // Shows the sign, takes one JPEG (*jpeg malloc'd, at most ADP_MAX_SNAPSHOT bytes) and returns 0.
  int (*snapshot)(unsigned char **jpeg, size_t *len, void *user);
  // speaker.play, advertised only when set: the owner's speaker grant. Plays one WAV (RIFF/WAVE checked,
  // at most ADP_MAX_PLAY bytes) to the end and returns 0, with *played false when it played nothing
  // because a person is talking at the device.
  int (*play)(const unsigned char *wav, size_t len, bool *played, void *user);
  // The owner's microphone grant: advertised, and needed for adp_audio().
  bool microphone;
  const char *wake_phrase;  // set while the owner's listen grant is on (S004); needs microphone
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
  // device events (reverse.md): the controller's one-use challenge, and the event waiting for its ack
  char event_challenge[ADP_HEX];
  char event_id[ADP_HEX];
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
// True when an event can be sent now: authenticated, a fresh event challenge, nothing waiting for an ack.
bool adp_event_ready(const adp_t *adp);
// What a person said, as the signed audio event (reverse.md): a WAV of 44 to ADP_MAX_AUDIO bytes. Needs
// the microphone grant and an encrypted connection (a plain home network connection may not carry it).
// *out is the message to send, encrypted when secure. Returns -1 when it cannot be sent now.
int adp_audio(adp_t *adp, const unsigned char *wav, size_t len, unsigned char **out, size_t *out_len, bool *out_binary);
// S003 key schedule: both direction keys from the X25519 result and the decoded hello and accept bodies.
void adp_secure_keys(const unsigned char shared[32], const unsigned char *hello, size_t hello_len,
                     const unsigned char *accept, size_t accept_len, unsigned char controller_to_device[32],
                     unsigned char device_to_controller[32]);
// Encrypts one message with the next sending counter: ciphertext then 16-byte tag, malloc'd.
int adp_secure_seal(adp_t *adp, const unsigned char *in, size_t len, unsigned char **out, size_t *out_len);
