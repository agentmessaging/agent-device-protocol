// Runs the firmware's ADP core on a computer, for tests/esp32-client.test.mjs.
//   adp_host key SEED_HEX                      print the public key
//   adp_host seal SEED_HEX < body              print the signed packet for these exact body bytes
//   adp_host bridge SEED_HEX OWNER_KEY AGENT [display] [camera] [secure]
//       one WebSocket text frame per line on stdin and stdout; display.text goes to stderr; camera answers
//       camera.snapshot with a fixed 300 KiB JPEG-shaped image. With secure
//       (S003), each line is "T <text>" or "B <hex>" for a text or binary message.
//       speaker answers speaker.play (stderr "PLAY <bytes>"); microphone grants the audio event:
//       with secure, the line "A <bytes>" sends a WAV of that size as one (stdout "NOAUDIO" when it cannot).
//   adp_host x25519 SECRET_HEX                 print the X25519 public key (S003 test vectors)
//   adp_host secure-keys SHARED_HEX HELLO_HEX ACCEPT_HEX   print both direction keys
//   adp_host secure-seal KEY_HEX < text        print the first message sealed with this key, as hex
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>

#include "../main/adp.h"
#include "../main/nets.h"
#include "sodium.h"

static int show(const char *text, void *user) {
  (void)user;
  fprintf(stderr, "SHOW %s\n", text);
  return 0;
}

// SOI, APP0, filler, EOI: enough for the core's signature check, and large enough to need the big-message path
static int snapshot(unsigned char **jpeg, size_t *len, void *user) {
  (void)user;
  *len = 300 * 1024;
  if (!(*jpeg = malloc(*len))) return -1;
  for (size_t i = 0; i < *len; i++) (*jpeg)[i] = (unsigned char)(i * 7);
  memcpy(*jpeg, "\xFF\xD8\xFF\xE0", 4);
  (*jpeg)[*len - 2] = 0xFF;
  (*jpeg)[*len - 1] = 0xD9;
  return 0;
}

static int play(const unsigned char *wav, size_t len, bool *played, void *user) {
  (void)user;
  (void)wav;
  fprintf(stderr, "PLAY %zu\n", len);
  *played = true;
  return 0;
}

// S005 on the host: the board's rules in memory; stderr "NETS" lines show what was stored, passwords included,
// so the test can check the answers never carry them
static adp_nets_t nets;
static int net_add(const char *ssid, const char *password, int *count, void *user) {
  (void)user;
  *count = adp_nets_add(&nets, ssid, password);
  fprintf(stderr, "NETS add %s %s\n", ssid, password);
  return 0;
}
static int net_remove(const char *ssid, bool *removed, int *count, void *user) {
  (void)user;
  *removed = adp_nets_remove(&nets, ssid);
  *count = nets.n;
  return 0;
}
static int net_list(char names[][33], char current[33], char setup[16], void *user) {
  (void)user;
  strcpy(setup, "TEST-CODE");
  for (int i = 0; i < nets.n; i++) strcpy(names[i], nets.e[i].ssid);
  strcpy(current, nets.n ? nets.e[0].ssid : "");
  return nets.n;
}

static int64_t now_ms(void) {
  struct timeval tv;
  gettimeofday(&tv, NULL);
  return (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000;
}

int main(int argc, char **argv) {
  unsigned char seed[32], pk[32], sk[64];
  size_t n = 0;
  if (sodium_init() < 0 || argc < 3 || sodium_hex2bin(seed, 32, argv[2], strlen(argv[2]), NULL, &n, NULL) || n != 32)
    return 2;
  crypto_sign_seed_keypair(pk, sk, seed);
  // Big enough for a hex binary message of the largest frame
  static char line[2 * (ADP_MAX_FRAME + 16) + 8];
  if (!strcmp(argv[1], "x25519")) {
    unsigned char x[32];
    char key[ADP_KEY];
    crypto_scalarmult_base(x, seed);
    sodium_bin2base64(key, ADP_KEY, x, 32, sodium_base64_VARIANT_URLSAFE_NO_PADDING);
    puts(key);
    return 0;
  }
  if (!strcmp(argv[1], "secure-keys") && argc == 5) {
    size_t hl = strlen(argv[3]) / 2, al = strlen(argv[4]) / 2;
    unsigned char *h = malloc(hl + 1), *a = malloc(al + 1), c2d[32], d2c[32];
    if (!h || !a || sodium_hex2bin(h, hl, argv[3], strlen(argv[3]), NULL, &hl, NULL) ||
        sodium_hex2bin(a, al, argv[4], strlen(argv[4]), NULL, &al, NULL))
      return 2;
    adp_secure_keys(seed, h, hl, a, al, c2d, d2c);
    char hc[65], hd[65];
    printf("%s %s\n", sodium_bin2hex(hc, sizeof hc, c2d, 32), sodium_bin2hex(hd, sizeof hd, d2c, 32));
    free(h);
    free(a);
    return 0;
  }
  if (!strcmp(argv[1], "secure-seal")) {
    adp_t s = {0};
    unsigned char *c;
    size_t clen, len = fread(line, 1, sizeof line, stdin);
    memcpy(s.sec_tx, seed, 32);
    if (adp_secure_seal(&s, (unsigned char *)line, len, &c, &clen)) return 2;
    for (size_t i = 0; i < clen; i++) printf("%02x", c[i]);
    puts("");
    free(c);
    return 0;
  }
  if (!strcmp(argv[1], "key")) {
    char key[ADP_KEY];
    adp_public_key(sk, key);
    puts(key);
    return 0;
  }
  if (!strcmp(argv[1], "seal")) {
    size_t len = fread(line, 1, sizeof line, stdin);
    char *p = adp_seal(sk, line, len);
    puts(p);
    free(p);
    return 0;
  }
  if (strcmp(argv[1], "bridge") || argc < 5) return 2;
  adp_t adp;
  if (adp_init(&adp, sk, argv[3], argv[4], "host")) return 3;
  for (int i = 5; i < argc; i++) {
    if (!strcmp(argv[i], "display")) adp.show_text = show;
    if (!strcmp(argv[i], "camera")) adp.snapshot = snapshot;
    if (!strcmp(argv[i], "secure")) adp.secure = true;
    if (!strcmp(argv[i], "speaker")) adp.play = play;
    if (!strcmp(argv[i], "microphone")) adp.microphone = true;
    if (!strcmp(argv[i], "listen")) adp.wake_phrase = "hey bruce";
    if (!strcmp(argv[i], "network")) {
      adp.net_add = net_add;
      adp.net_remove = net_remove;
      adp.net_list = net_list;
    }
  }
  adp_new_session(&adp);
  setvbuf(stdout, NULL, _IOLBF, 0);
  static unsigned char bin[ADP_MAX_FRAME + 16 + 1];
  while (fgets(line, sizeof line, stdin)) {
    size_t len = strcspn(line, "\n");
    const unsigned char *data = (unsigned char *)line;
    bool binary = false;
    if (line[0] == 'A' && line[1] == ' ') {  // the person talked: send a WAV of this many bytes
      size_t n = strtoul(line + 2, NULL, 10);
      unsigned char *wav = calloc(1, n > 44 ? n : 44), *out;
      size_t out_len;
      bool out_binary;
      memcpy(wav, "RIFF", 4);
      memcpy(wav + 8, "WAVE", 4);
      if (adp_audio(&adp, wav, n, &out, &out_len, &out_binary)) {
        puts("NOAUDIO");
      } else {
        putchar('B');
        putchar(' ');
        for (size_t i = 0; i < out_len; i++) printf("%02x", out[i]);
        putchar('\n');
        free(out);
      }
      free(wav);
      continue;
    }
    if (adp.secure) {  // "T <text>" or "B <hex>"
      if (len < 2 || line[1] != ' ' || (line[0] != 'T' && line[0] != 'B')) return 1;
      binary = line[0] == 'B';
      data += 2;
      len -= 2;
      if (binary && (sodium_hex2bin(bin, sizeof bin, line + 2, len, NULL, &len, NULL))) return 1;
      if (binary) data = bin;
    }
    unsigned char *out;
    size_t out_len;
    bool out_binary;
    if (adp_receive(&adp, data, len, binary, now_ms(), &out, &out_len, &out_binary)) return 1;  // the device closes
    if (out && !adp.secure) puts((char *)out);
    else if (out && !out_binary) printf("T %.*s\n", (int)out_len, out);
    else if (out) {
      putchar('B');
      putchar(' ');
      for (size_t i = 0; i < out_len; i++) printf("%02x", out[i]);
      putchar('\n');
    }
    free(out);
  }
  return 0;
}
