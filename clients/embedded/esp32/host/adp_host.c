// Runs the firmware's ADP core on a computer, for tests/esp32-client.test.mjs.
//   adp_host key SEED_HEX                      print the public key
//   adp_host seal SEED_HEX < body              print the signed packet for these exact body bytes
//   adp_host bridge SEED_HEX OWNER_KEY AGENT [display]
//       one WebSocket text frame per line on stdin and stdout; display.text goes to stderr
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>

#include "../main/adp.h"
#include "sodium.h"

static int show(const char *text, void *user) {
  (void)user;
  fprintf(stderr, "SHOW %s\n", text);
  return 0;
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
  static char line[ADP_MAX_FRAME + 2];
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
  if (argc > 5 && !strcmp(argv[5], "display")) adp.show_text = show;
  adp_new_session(&adp);
  setvbuf(stdout, NULL, _IOLBF, 0);
  while (fgets(line, sizeof line, stdin)) {
    char *out;
    if (adp_handle(&adp, line, strcspn(line, "\n"), now_ms(), &out)) return 1;  // the device closes
    if (out) puts(out);
    free(out);
  }
  return 0;
}
