// End of speech for the talk control: decides, 30 ms at a time, when a person has finished talking.
// No I/O, so tests/esp32-vad.test.mjs runs it on recordings made by the board.
#pragma once
#include <stdbool.h>
#include <stdint.h>

#define ADP_VAD_FRAME 480       // 30 ms at 16 kHz
#define ADP_VAD_HISTORY 50      // the quiet level is the quietest frame of the last 1.5 s
#define ADP_VAD_ABOVE_DB 10.0f  // speech is this far above the quiet level
#define ADP_VAD_QUIET_END_MS 1000
// Speech is at least this loud (after the low cut, before the recording's gain). Measured on the XIAO's PDM mic
// (2026-11-23): voices at arm's length -53 to -55 dBFS at their loudest, room noise -66 to -70. At the old -70 a quiet
// room's noise counted as speech in the answer window, and the agent answered words nobody said, in a loop.
#define ADP_VAD_MIN_DB -62.0f
#define ADP_VAD_MIN_SPEECH 5  // frames (150 ms) of speech before a person counts as having spoken
#define ADP_VAD_MIN_ANSWER 13  // in the answer window, which nobody opened on purpose: 400 ms (a clack was 2 x 200 ms)

typedef struct {
  float hp_x, hp_y;  // high-pass filter state
  float history[ADP_VAD_HISTORY];
  int frames, quiet_ms, since, speech;  // since: frames since the last (re)start, for the nobody limit
  bool spoke;
  int min_speech;  // frames needed; 0 means ADP_VAD_MIN_SPEECH
  float quiet_db;
} adp_vad_t;

enum { ADP_VAD_GOING = 0, ADP_VAD_DONE = 1, ADP_VAD_NOBODY = 2 };

void adp_vad_init(adp_vad_t *v);
// A new utterance that keeps the room level learned so far (the board listened before it recorded)
void adp_vad_restart(adp_vad_t *v);
// One frame of ADP_VAD_FRAME samples. Returns ADP_VAD_DONE one second after speech ended, ADP_VAD_NOBODY
// when nobody spoke within nobody_ms, otherwise ADP_VAD_GOING.
int adp_vad_frame(adp_vad_t *v, const int16_t *s, int nobody_ms);
// Removes what is below about 150 Hz, in place: the microphone's offset, and the hum of a class-D amplifier
// on the same supply, which is louder than the room and once kept "speech" going for 20 seconds.
// adp_vad_frame() expects filtered frames.
void adp_vad_highpass(adp_vad_t *v, int16_t *s, int n);
