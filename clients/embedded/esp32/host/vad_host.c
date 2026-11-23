// Runs the talk control's end-of-speech decision on raw 16 kHz mono int16 audio from stdin, for
// tests/esp32-vad.test.mjs. Prints "going|done|nobody MS".
#include <stdio.h>
#include <stdlib.h>

#include "../main/vad.h"

int main(int argc, char **argv) {
  int nobody = argc > 1 ? atoi(argv[1]) : 5000, ms = 0, r = ADP_VAD_GOING;
  int16_t frame[ADP_VAD_FRAME];
  adp_vad_t v;
  adp_vad_init(&v);
  while (r == ADP_VAD_GOING && fread(frame, sizeof frame, 1, stdin) == 1) {
    adp_vad_highpass(&v, frame, ADP_VAD_FRAME);
    r = adp_vad_frame(&v, frame, nobody);
    ms += 30;
  }
  while (fread(frame, sizeof frame, 1, stdin) == 1) {}  // drain, so the writer never sees a closed pipe
  printf("%s %d\n", r == ADP_VAD_DONE ? "done" : r == ADP_VAD_NOBODY ? "nobody" : "going", ms);
  return 0;
}
