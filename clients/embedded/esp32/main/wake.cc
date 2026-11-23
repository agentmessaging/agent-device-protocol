// Wake phrase detector (docs/wiki/specs/S004): a microWakeWord streaming model on the microphone.
// It sees 30 ms of audio at a time and keeps no audio: only the front end's state, the model's state and
// the last five probabilities. It answers one thing: heard the phrase, or not.
// Front end and quantization as the model was trained (pymicro-features, ESPHome's micro_wake_word).
#include <string.h>

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "sdkconfig.h"
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/micro/micro_mutable_op_resolver.h"
#include "tensorflow/lite/micro/micro_resource_variable.h"

extern "C" {
#include "frontend.h"
#include "frontend_util.h"
}

extern const uint8_t model_data[] asm("_binary_wake_model_tflite_start");

static const char *TAG = "wake";
static const int ARENA = 40 * 1024;  // the model's metadata asks for 30,000 bytes
static const int VARIABLES = 1024;
static const int WINDOW = 5;
static const int WARMUP = 74;  // steps after a reset with no detection, as ESPHome does: the model state settles

static FrontendState fe;
static tflite::MicroInterpreter *interp;
static TfLiteTensor *in, *out;
static int stride, row, steps;
static uint8_t probs[WINDOW];
static int peak;  // debug: the highest window mean since the last call to adp_wake_peak

extern "C" bool adp_wake_init(void) {
  FrontendConfig c;
  c.window.size_ms = 30;
  c.window.step_size_ms = 10;
  c.filterbank.num_channels = 40;
  c.filterbank.lower_band_limit = 125.0f;
  c.filterbank.upper_band_limit = 7500.0f;
  c.noise_reduction.smoothing_bits = 10;
  c.noise_reduction.even_smoothing = 0.025f;
  c.noise_reduction.odd_smoothing = 0.06f;
  c.noise_reduction.min_signal_remaining = 0.05f;
  c.pcan_gain_control.enable_pcan = 1;
  c.pcan_gain_control.strength = 0.95f;
  c.pcan_gain_control.offset = 80.0f;
  c.pcan_gain_control.gain_bits = 21;
  c.log_scale.enable_log = 1;
  c.log_scale.scale_shift = 6;
  if (!FrontendPopulateState(&c, &fe, 16000)) return false;

  const tflite::Model *model = tflite::GetModel(model_data);
  static tflite::MicroMutableOpResolver<16> ops;
  // the 13 operations a microWakeWord streaming model uses
  if (ops.AddAssignVariable() || ops.AddCallOnce() || ops.AddConcatenation() || ops.AddConv2D() ||
      ops.AddDepthwiseConv2D() || ops.AddFullyConnected() || ops.AddLogistic() || ops.AddQuantize() ||
      ops.AddReadVariable() || ops.AddReshape() || ops.AddSplitV() || ops.AddStridedSlice() || ops.AddVarHandle())
    return false;
  // Internal RAM is faster; with Bluetooth on (the setup mode) it may be short, and PSRAM is fast enough for 3 steps
  // every 30 ms
  uint8_t *arena = (uint8_t *)heap_caps_malloc_prefer(ARENA, 2, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT, MALLOC_CAP_SPIRAM);
  uint8_t *vars = (uint8_t *)heap_caps_malloc_prefer(VARIABLES, 2, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT, MALLOC_CAP_SPIRAM);
  if (!arena || !vars) ESP_LOGE(TAG, "No memory for the model (%u bytes)", (unsigned)ARENA);
  if (!arena || !vars) return false;
  tflite::MicroAllocator *va = tflite::MicroAllocator::Create(vars, VARIABLES);
  tflite::MicroResourceVariables *rv = tflite::MicroResourceVariables::Create(va, 20);
  interp = new tflite::MicroInterpreter(model, ops, arena, ARENA, rv);
  if (interp->AllocateTensors() != kTfLiteOk) {
    ESP_LOGE(TAG, "The model does not fit or uses other operations");
    return false;
  }
  in = interp->input(0);
  out = interp->output(0);
  if (in->type != kTfLiteInt8 || in->dims->size != 3 || in->dims->data[2] != 40 || out->type != kTfLiteUInt8) {
    ESP_LOGE(TAG, "Not a microWakeWord streaming model");
    return false;
  }
  stride = in->dims->data[1];
  ESP_LOGI(TAG, "Listening for \"%s\": %d feature steps per inference, arena %u bytes used", CONFIG_ADP_WAKE_PHRASE,
           stride, (unsigned)interp->arena_used_bytes());
  return true;
}

// After a pause (recording, playback), so old audio cannot complete a detection
extern "C" void adp_wake_reset(void) {
  FrontendReset(&fe);
  memset(probs, 0, sizeof probs);
  row = 0;
  steps = 0;
}

extern "C" int adp_wake_peak(void) {
  int p = peak * 100 / (255 * WINDOW);
  peak = 0;
  return p;
}

// n samples of 16 kHz microphone audio. True when the phrase was heard.
extern "C" bool adp_wake_feed(const int16_t *s, int n) {
  bool heard = false;
  while (n > 0) {
    size_t used;
    FrontendOutput f = FrontendProcessSamples(&fe, s, n, &used);
    s += used;
    n -= used;
    if (!f.size) continue;
    int8_t *dst = in->data.int8 + row * 40;
    for (size_t i = 0; i < f.size && i < 40; i++) {
      // feature / 25.6 is the trained input, quantized by scale 26/256 and zero point -128
      int32_t v = ((int32_t)f.values[i] * 256 + 333) / 666 - 128;
      dst[i] = (int8_t)(v < -128 ? -128 : v > 127 ? 127 : v);
    }
    if (++row < stride) continue;
    row = 0;
    if (interp->Invoke() != kTfLiteOk) {
      ESP_LOGW(TAG, "Inference failed");
      continue;
    }
    probs[steps % WINDOW] = out->data.uint8[0];
    if (++steps < WARMUP) continue;
    int sum = 0;
    for (int i = 0; i < WINDOW; i++) sum += probs[i];
    if (sum > peak) peak = sum;
    if (sum > CONFIG_ADP_WAKE_CUTOFF * 255 * WINDOW / 100) {
      ESP_LOGI(TAG, "Heard \"%s\" (%d%%)", CONFIG_ADP_WAKE_PHRASE, sum * 100 / (255 * WINDOW));
      adp_wake_reset();
      heard = true;
    }
  }
  return heard;
}
