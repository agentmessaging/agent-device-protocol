#include "vad.h"

#include <math.h>
#include <string.h>

void adp_vad_init(adp_vad_t *v) { memset(v, 0, sizeof *v); }

void adp_vad_highpass(adp_vad_t *v, int16_t *s, int n) {
  const float a = 0.944f;  // one pole, RC / (RC + 1/16000) for a corner near 150 Hz
  for (int i = 0; i < n; i++) {
    float y = a * (v->hp_y + s[i] - v->hp_x);
    v->hp_x = s[i];
    v->hp_y = y;
    s[i] = (int16_t)fmaxf(-32768, fminf(32767, y));
  }
}

int adp_vad_frame(adp_vad_t *v, const int16_t *s, int nobody_ms) {
  double sum = 0;
  for (int i = 0; i < ADP_VAD_FRAME; i++) sum += (double)s[i] * s[i];
  float db = 20 * log10f(sqrtf(sum / ADP_VAD_FRAME) / 32768 + 1e-9f);
  v->history[v->frames % ADP_VAD_HISTORY] = db;
  v->frames++;
  // The room is one of the quietest frames of the last 1.5 s: speech always has short pauses, so talking
  // cannot raise it, and it rises with a steady sound such as a fan. The 5th quietest, not the quietest:
  // one freak frame once dragged the level so low that the whole room counted as speech (20 s recorded).
  int n = v->frames < ADP_VAD_HISTORY ? v->frames : ADP_VAD_HISTORY, k = n < 5 ? n - 1 : 4;
  float sorted[ADP_VAD_HISTORY];
  memcpy(sorted, v->history, n * sizeof *sorted);
  for (int i = 0; i <= k; i++)  // partial selection sort: only the k+1 smallest
    for (int j = i + 1; j < n; j++)
      if (sorted[j] < sorted[i]) {
        float t = sorted[i];
        sorted[i] = sorted[j];
        sorted[j] = t;
      }
  float quiet = sorted[k];
  v->quiet_db = quiet;
  // The first 300 ms only learn the room
  bool speech = v->frames > 10 && db > quiet + ADP_VAD_ABOVE_DB && db > -70;
  if (speech) {
    v->spoke = true;
    v->quiet_ms = 0;
  } else if (v->spoke && (v->quiet_ms += 30) >= ADP_VAD_QUIET_END_MS) {
    return ADP_VAD_DONE;
  }
  if (!v->spoke && v->frames * 30 >= nobody_ms) return ADP_VAD_NOBODY;
  return ADP_VAD_GOING;
}
