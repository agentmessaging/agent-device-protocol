// The ESP32 talk control's end of speech (clients/embedded/esp32/main/vad.c), on synthetic audio.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const src = new URL("../clients/embedded/esp32/", import.meta.url).pathname;
let bin, skip;
try {
  bin = join(mkdtempSync(join(tmpdir(), "adp-vad-")), "vad_host");
  execFileSync("cc", ["-Wall", "-Werror", "-O1", "-o", bin, src + "main/vad.c", src + "host/vad_host.c", "-lm"]);
} catch (error) {
  skip = "C compiler unavailable: " + error.message.split("\n")[0];
}

const RATE = 16000;
let seed = 1;
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
/** parts: [seconds, dBFS, kind] where kind is "noise" or "voice" (a 220 Hz buzz with noise, like a vowel) */
function audio(parts) {
  const out = [];
  for (const [seconds, db, kind] of parts) {
    const amp = 32768 * 10 ** (db / 20);
    for (let i = 0; i < seconds * RATE; i++)
      out.push(Math.round(amp * (kind === "hum" ? (0.6 + 0.4 * Math.sin((2 * Math.PI * 0.5 * i) / RATE)) * Math.sin((2 * Math.PI * 8 * i) / RATE) : kind === "voice" ? 0.7 * Math.sin((2 * Math.PI * 220 * i) / RATE) + 0.3 * random() : random())));
  }
  return Buffer.from(Int16Array.from(out).buffer);
}
const speak = (seconds, pause = 0.2) => {
  const parts = [];
  for (let t = 0; t < seconds; t += 0.8) parts.push([0.6, -25, "voice"], [pause, -55, "noise"]);
  return parts;
};
const run = (parts, nobody = 5000) => {
  const [result, ms] = execFileSync(bin, [String(nobody)], { input: audio(parts) }).toString().trim().split(" ");
  return { result, seconds: Number(ms) / 1000 };
};

test("ends one second after the person stops talking", { skip }, () => {
  const r = run([[1, -55, "noise"], ...speak(3), [4, -55, "noise"]]);
  assert.equal(r.result, "done");
  assert.ok(r.seconds > 4.6 && r.seconds < 5.4, String(r.seconds));
});

test("sends nothing when nobody talks", { skip }, () => {
  assert.deepEqual(run([[8, -55, "noise"]]), { result: "nobody", seconds: 5.01 });
});

test("one freak quiet frame does not turn the room into speech", { skip }, () => {
  // The old detector took the quietest frame as the room and recorded 20 seconds
  assert.equal(run([[0.6, -45, "noise"], [0.03, -90, "noise"], [8, -45, "noise"]]).result, "nobody");
});

test("a fan spinning up is not speech", { skip }, () => {
  const ramp = Array.from({ length: 30 }, (_, i) => [0.1, -60 + i * 0.5, "noise"]);
  assert.equal(run([...ramp, [5, -45, "noise"]]).result, "nobody");
});

test("a long sentence with short pauses is not cut off", { skip }, () => {
  const r = run([[1, -55, "noise"], ...speak(12, 0.3), [3, -55, "noise"]]);
  assert.equal(r.result, "done");
  assert.ok(r.seconds > 13.5, String(r.seconds));
});

test("speech over a steady fan still ends", { skip }, () => {
  const parts = [[1, -42, "noise"], ...speak(3).map(([s, db, k]) => [s, k === "voice" ? -20 : -42, k]), [3, -42, "noise"]];
  assert.equal(run(parts).result, "done");
});

test("a slow drift of the microphone signal is not speech", { skip }, () => {
  // Measured on the board with the amplifier connected: after the person stopped, a drift below 20 Hz,
  // about 30 dB over the room noise, kept the recording going for 20 seconds
  const r = run([[1, -55, "noise"], ...speak(3), [10, -25, "hum"]]);
  assert.equal(r.result, "done");
  assert.ok(r.seconds < 5.5, String(r.seconds));
});
