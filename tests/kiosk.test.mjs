import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// state.mjs reads ADP_HOME when it loads
const home = mkdtempSync(join(tmpdir(), "adp-kiosk-"));
process.env.ADP_HOME = home;
test.after(() => rmSync(home, { recursive: true, force: true }));
const { peer, setMediaConsent, setOutputConsent, revokeAllGrants } = await import(
  "../packages/sdk/state.mjs"
);
const { DisplayState, displayServer, GROUPS } = await import("../apps/display/server.mjs");
const { bridge } = await import("../clients/linux/server.mjs");
const { Voice, envelope, loudness } = await import("../clients/linux/output.mjs");
const { PushToTalk } = await import("../clients/linux/talk.mjs");
const { CameraPreview } = await import("../clients/linux/preview.mjs");
const { MediaManager } = await import("../clients/linux/media.mjs");
const { identity, exchange } = await import("../packages/sdk/index.mjs");

const owner = identity(),
  device = identity();
const allOn = () => ({
  key: owner.key,
  assignedAgent: "lola@mini.local",
  revision: "one",
  camera: true,
  media: { video: true, microphone: true, speaker: true },
  outputs: {
    "display.text": true,
    "display.image": true,
    "speaker.say": true,
    "speaker.play": true,
  },
  custom: { "custom.home.lights": true },
});
const save = (policy) => writeFileSync(join(home, "peer.json"), JSON.stringify(policy));

async function listen(t, server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  return "http://127.0.0.1:" + server.address().port;
}
async function kiosk(t, extra = {}) {
  const display = new DisplayState(peer);
  const log = [];
  const origin = await listen(
    t,
    displayServer(display, {
      setConsent: setMediaConsent,
      setOutputs: setOutputConsent,
      revokeAll: revokeAllGrants,
      stopAll: () => log.push("stopAll"),
      ...extra,
    }),
  );
  const { controlToken } = await (await fetch(origin + "/state")).json();
  const post = (path, body) =>
    fetch(origin + path, {
      method: "POST",
      headers: { Origin: origin, "X-Display-Token": controlToken },
      body: JSON.stringify(body),
    });
  const state = async () => (await fetch(origin + "/state")).json();
  return { display, origin, post, state, log };
}
async function snapshotter(t, display) {
  const origin = await listen(
    t,
    bridge(
      device,
      peer,
      {
        cameraReady: () => true,
        indicatorReady: () => true,
        indicate: async () => {},
        snapshot: async () => ({ mime: "image/jpeg", data: "/9j/2Q==" }),
      },
      display,
    ),
  );
  return () =>
    exchange(origin, owner, device.key, { type: "invoke", capability: "camera.snapshot" }, "result");
}
const eight = (p) => [
  p.camera,
  ...["video", "microphone", "speaker"].map((k) => p.media[k]),
  ...["display.text", "display.image", "speaker.say", "speaker.play"].map((k) => p.outputs[k]),
];

test("each switch turns on and off exactly its grants", async (t) => {
  const { post } = await kiosk(t);
  const expected = {
    camera: ["camera", "video"],
    microphone: ["microphone"],
    speaker: ["speaker", "speaker.say", "speaker.play"],
    screen: ["display.text", "display.image"],
  };
  const read = (p, name) =>
    name === "camera" ? p.camera : name in p.outputs ? p.outputs[name] : p.media[name];
  const names = Object.values(expected).flat();
  for (const [group, grants] of Object.entries(expected)) {
    save(allOn());
    assert.equal((await post("/grant", { group, on: false })).status, 204);
    for (const name of names)
      assert.equal(read(peer(), name), !grants.includes(name), group + " off: " + name);
    assert.equal((await post("/grant", { group, on: true })).status, 204);
    assert.deepEqual(eight(peer()), Array(8).fill(true));
  }
  assert.deepEqual(Object.keys(GROUPS), Object.keys(expected));
  assert.equal((await post("/grant", { group: "constructor", on: false })).status, 400);
  assert.equal((await post("/grant", { group: "camera", on: "no" })).status, 400);
});

test("a switch reads on only if all of its grants are on", async (t) => {
  const { state } = await kiosk(t);
  save(allOn());
  assert.deepEqual((await state()).switches, {
    camera: true,
    microphone: true,
    speaker: true,
    screen: true,
  });
  for (const [change, group] of [
    [{ camera: false }, "camera"],
    [{ media: { ...allOn().media, video: false } }, "camera"],
    [{ media: { ...allOn().media, speaker: false } }, "speaker"],
    [{ outputs: { ...allOn().outputs, "speaker.play": false } }, "speaker"],
    [{ outputs: { ...allOn().outputs, "display.image": false } }, "screen"],
  ]) {
    save({ ...allOn(), ...change });
    const { switches } = await state();
    assert.equal(switches[group], false, JSON.stringify(change));
    assert.equal(Object.values(switches).filter(Boolean).length, 3);
  }
});

test("stop turns off every grant, stops what runs, and a snapshot is denied after it", async (t) => {
  save(allOn());
  const { post, display, log } = await kiosk(t);
  const snapshot = await snapshotter(t, display);
  assert.equal((await snapshot()).ok, true);
  assert.equal((await post("/stop", {})).status, 204);
  assert.deepEqual(eight(peer()), Array(8).fill(false));
  assert.deepEqual(peer().custom, { "custom.home.lights": false });
  assert.deepEqual(log, ["stopAll"]);
  const result = await snapshot();
  assert.deepEqual([result.ok, result.error], [false, "denied"]);
});

test("Camera off denies a snapshot; Camera on allows it again", async (t) => {
  save(allOn());
  const { post, display } = await kiosk(t);
  const snapshot = await snapshotter(t, display);
  await post("/grant", { group: "camera", on: false });
  const result = await snapshot();
  assert.deepEqual([result.ok, result.error], [false, "denied"]);
  await post("/grant", { group: "camera", on: true });
  assert.equal((await snapshot()).ok, true);
});

test("stop still stops what runs on a device with nothing assigned", async (t) => {
  const { post, log } = await kiosk(t, {
    revokeAll: () => {
      throw new Error("no peer");
    },
  });
  assert.equal((await post("/stop", {})).status, 400);
  assert.deepEqual(log, ["stopAll"]);
});

test("turning the microphone off ends a recording; the camera switch does not", async (t) => {
  save(allOn());
  const { post, log } = await kiosk(t);
  await post("/grant", { group: "camera", on: false });
  assert.deepEqual(log, []);
  await post("/grant", { group: "microphone", on: false });
  assert.deepEqual(log, ["stopAll"]);
});

// A stand-in for aplay: runs until told to stop, or until finish() is called
function fakePlayer() {
  const player = { started: 0, killed: 0 };
  player.play = (_bytes, signal) =>
    new Promise((resolve, reject) => {
      player.started++;
      player.finish = () => resolve({ played: true });
      signal.addEventListener("abort", () => {
        player.killed++;
        reject(new Error("killed"));
      });
    });
  return player;
}
const fakeDisplay = () => ({ indicate: async () => {}, keepIndicator() {} });
const talker = (voice, display = fakeDisplay()) =>
  new PushToTalk({
    getPeer: () => ({ media: { microphone: true } }),
    display,
    voice,
    capture: (_kind, _seconds, onData) => {
      onData(Buffer.alloc(32000));
      return () => {};
    },
    send: async () => {},
  });

test("talking kills what she is saying and drops what still arrives, then she can speak again", async () => {
  const player = fakePlayer();
  const voice = new Voice({ play: player.play, say: player.play });
  const talk = talker(voice);
  const running = voice.play(Buffer.alloc(0));
  assert.equal(voice.speaking(), true);
  await talk.start();
  assert.deepEqual(await running, { played: false });
  assert.equal(player.killed, 1);
  assert.equal(voice.speaking(), false);
  assert.deepEqual(await voice.play(Buffer.alloc(0)), { played: false });
  assert.deepEqual(await voice.say("more"), { played: false });
  assert.equal(player.started, 1);
  await talk.stop();
  const next = voice.play(Buffer.alloc(0));
  assert.equal(player.started, 2);
  player.finish();
  assert.deepEqual(await next, { played: true });
});

test("a cancelled talk, or one that could not start, gives her voice back", async () => {
  const voice = new Voice({ play: async () => ({ played: true }) });
  const talk = talker(voice);
  await talk.start();
  talk.cancel();
  assert.equal(voice.hushed, false);
  const broken = talker(voice, {
    ...fakeDisplay(),
    indicate: async () => {
      throw new Error("no sign");
    },
  });
  await assert.rejects(broken.start());
  assert.equal(voice.hushed, false);
});

test("a stop that lands while the sign comes up ends the talk before it records", async () => {
  let policy = { media: { microphone: true } };
  let recorded = false;
  const voice = new Voice({ play: async () => ({ played: true }) });
  const talk = new PushToTalk({
    getPeer: () => policy,
    display: {
      ...fakeDisplay(),
      indicate: async () => {
        policy = { media: { microphone: false } };
      },
    },
    voice,
    capture: () => {
      recorded = true;
    },
  });
  await assert.rejects(talk.start());
  assert.equal(recorded, false);
  assert.equal(voice.hushed, false);
});

test("a talk refused by the grant does not cut her off", async () => {
  const player = fakePlayer();
  const voice = new Voice({ play: player.play });
  const talk = new PushToTalk({ getPeer: () => ({}), display: fakeDisplay(), voice });
  const running = voice.play(Buffer.alloc(0));
  await assert.rejects(talk.start());
  assert.equal(player.killed, 0);
  player.finish();
  await running;
});

test("the bridge answers speaker.play during a talk without playing it", async (t) => {
  const played = [];
  const voice = new Voice({
    play: async (bytes) => {
      played.push(bytes);
      return { played: true };
    },
  });
  save(allOn());
  const origin = await listen(
    t,
    bridge(device, peer, { cameraReady: () => false, playReady: () => true, voice }),
  );
  const riff = Buffer.alloc(44);
  riff.write("RIFF", 0, "latin1");
  riff.write("WAVE", 8, "latin1");
  voice.hush();
  const result = await exchange(
    origin,
    owner,
    device.key,
    {
      type: "invoke",
      capability: "speaker.play",
      args: { mime: "audio/wav", data: riff.toString("base64") },
    },
    "result",
  );
  assert.deepEqual([result.ok, result.value], [true, { played: false }]);
  assert.equal(played.length, 0);
});

function wavFile(pcm, rate = 16000, channels = 1) {
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write("WAVEfmt ", 8, "latin1");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(channels, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * channels * 2, 28);
  head.writeUInt16LE(channels * 2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36, "latin1");
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}
function tone(ms, amplitude, rate = 16000) {
  const pcm = Buffer.alloc((rate * ms * 2) / 1000);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2);
  return pcm;
}

test("levels: silence is 0, loud is near 1, and the envelope follows the WAV", () => {
  assert.equal(loudness(Buffer.alloc(3200)), 0);
  assert.equal(loudness(Buffer.alloc(0)), 0);
  assert.ok(loudness(tone(100, 32767)) === 1);
  assert.ok(loudness(tone(100, 1000)) > 0.2);
  const levels = envelope(wavFile(Buffer.concat([tone(100, 20000), tone(100, 0)])));
  assert.equal(levels.length, 4);
  assert.ok(levels[0] > 0.5 && levels[1] > 0.5);
  assert.deepEqual(levels.slice(2), [0, 0]);
  assert.deepEqual(envelope(Buffer.from("RIFF....WAVE")), []);
  const eightBit = wavFile(tone(100, 100));
  eightBit.writeUInt16LE(8, 34);
  assert.deepEqual(envelope(eightBit), []);
  // ffmpeg writes this size when it pipes a WAV
  const piped = wavFile(tone(100, 20000));
  piped.writeUInt32LE(0xffffffff, 40);
  assert.equal(envelope(piped).length, 2);
});

test("the agent's level advances with time and ends with the audio", async () => {
  let now = 1000;
  const player = fakePlayer();
  const voice = new Voice({ play: player.play, now: () => now });
  assert.equal(voice.level(), 0);
  const running = voice.play(wavFile(Buffer.concat([tone(50, 0), tone(50, 20000)])));
  assert.equal(voice.level(), 0);
  now += 60;
  assert.ok(voice.level() > 0.5);
  now += 1000;
  assert.equal(voice.level(), 0);
  player.finish();
  await running;
  assert.equal(voice.speaking(), false);
});

test("/levels and speaking report real audio, and your level comes from the talk's chunks", async (t) => {
  save(allOn());
  const { origin, display, state } = await kiosk(t);
  const levels = async () => (await fetch(origin + "/levels")).json();
  assert.deepEqual(await levels(), { you: 0, agent: 0 });
  const player = fakePlayer();
  display.voice = new Voice({ play: player.play });
  const running = display.voice.play(wavFile(tone(500, 20000)));
  assert.equal((await state()).speaking, true);
  assert.ok((await levels()).agent > 0.5);
  player.finish();
  await running;
  assert.equal((await state()).speaking, false);
  let chunk;
  const talk = new PushToTalk({
    getPeer: peer,
    display: Object.assign(display, { indicate: async () => {} }),
    capture: (_kind, _seconds, onData) => {
      chunk = onData;
      return () => {};
    },
    send: async () => {},
  });
  await talk.start();
  assert.equal((await state()).talking, true);
  chunk(tone(100, 8000));
  assert.ok((await levels()).you > 0.3);
  await talk.stop();
  assert.equal((await state()).talking, false);
  assert.equal((await levels()).you, 0);
});

test("/talk says whether anything was sent, so a slip does not read as Thinking", async (t) => {
  save(allOn());
  const { post } = await kiosk(t, { talk: async (action) => action === "stop" });
  assert.deepEqual(await (await post("/talk", { action: "start" })).json(), { sent: false });
  assert.deepEqual(await (await post("/talk", { action: "stop" })).json(), { sent: true });
});

test("You said goes to the You line, without the prefix; anything else is the agent's", () => {
  const policy = allOn();
  const display = new DisplayState(() => policy);
  display.show(policy, { text: "You said: where is Felipe?" });
  display.show(policy, { text: "He is in Bogotá." });
  display.show(policy, { text: "you said: not a transcript" });
  const state = display.read();
  assert.equal(state.heard.text, "where is Felipe?");
  assert.equal(state.output.text, "you said: not a transcript");
  display.show(policy, { text: "You said:no space" });
  assert.equal(display.read().output.text, "You said:no space");
  assert.equal(display.read().heard.text, "where is Felipe?");
});

test("a picture keeps its place when she speaks, and all of it clears with the grant", async (t) => {
  save(allOn());
  const { origin, display, post, state } = await kiosk(t);
  display.show(peer(), { mime: "image/png", data: Buffer.from("png").toString("base64") });
  display.show(peer(), { text: "Here it is" });
  display.show(peer(), { text: "You said: show me" });
  const shown = await state();
  assert.equal(shown.output.text, "Here it is");
  assert.equal(shown.output.data, undefined);
  const picture = await fetch(origin + "/output/" + shown.picture.at);
  assert.equal(picture.headers.get("content-type"), "image/png");
  assert.equal(await picture.text(), "png");
  await post("/grant", { group: "screen", on: false });
  const cleared = await state();
  assert.deepEqual([cleared.output, cleared.heard, cleared.picture], [null, null, null]);
  assert.equal((await fetch(origin + "/output/" + shown.picture.at)).status, 404);
});

function fakeCamera() {
  const camera = { runs: 0, stops: 0 };
  camera.capture = (onData, onEnd) => {
    camera.runs++;
    camera.frame = onData;
    camera.end = onEnd;
    camera.active = true;
    return () => {
      camera.stops++;
      camera.active = false;
      setImmediate(onEnd);
    };
  };
  return camera;
}
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

test("the preview runs only for a viewer with the grants on, as multipart JPEG", async (t) => {
  const camera = fakeCamera();
  let allowed = true;
  const preview = new CameraPreview({
    allowed: () => allowed,
    ready: () => true,
    capture: camera.capture,
  });
  t.after(() => preview.close());
  const { origin, state } = await kiosk(t, { preview });
  assert.equal((await state()).preview, "ready");
  assert.equal(camera.runs, 0);
  const abort = new AbortController();
  const response = await fetch(origin + "/preview", { signal: abort.signal });
  assert.match(response.headers.get("content-type"), /^multipart\/x-mixed-replace; boundary=frame/);
  assert.equal(camera.runs, 1);
  camera.frame(Buffer.from([255, 216, 255, 217]));
  const reader = response.body.getReader();
  const { value } = await reader.read();
  assert.match(Buffer.from(value).toString("latin1"), /^--frame\r\nContent-Type: image\/jpeg\r\n/);
  allowed = false;
  await tick(150);
  assert.equal(camera.active, false);
  allowed = true;
  await tick(150);
  assert.equal(camera.active, true);
  abort.abort();
  await tick(50);
  assert.equal(camera.active, false);
  assert.equal(preview.timer, undefined);
});

test("the preview lets go of the camera for a snapshot or a video session, then comes back", async (t) => {
  const camera = fakeCamera();
  const preview = new CameraPreview({
    allowed: () => true,
    ready: () => true,
    capture: camera.capture,
  });
  t.after(() => preview.close());
  const { origin } = await kiosk(t, { preview });
  const abort = new AbortController();
  await fetch(origin + "/preview", { signal: abort.signal });
  t.after(() => abort.abort());
  await preview.exclusive(async () => assert.equal(camera.active, false));
  assert.equal(camera.active, true);
  await tick(150);
  assert.equal(camera.runs, 2);

  const policy = allOn();
  let opened;
  const manager = new MediaManager(
    () => policy,
    { indicatorReady: () => true, indicate: async () => {}, mediaStarted() {}, mediaStopped() {} },
    {
      mediaAvailable: () => true,
      captureMedia: () => {
        opened = camera.active;
        return () => {};
      },
      pauseCamera: () => preview.pause(),
      resumeCamera: () => preview.resume(),
    },
  );
  manager.run("video", policy, 1, () => {}, () => {});
  await tick(20);
  assert.equal(opened, false);
  manager.stopAll();
  assert.equal(camera.active, true);
});

test("a camera that fails is retried slowly, not in a tight loop", async (t) => {
  const camera = fakeCamera();
  const preview = new CameraPreview({
    allowed: () => true,
    ready: () => true,
    capture: camera.capture,
  });
  t.after(() => preview.close());
  const { origin } = await kiosk(t, { preview });
  const abort = new AbortController();
  await fetch(origin + "/preview", { signal: abort.signal });
  t.after(() => abort.abort());
  camera.end("hardware_unavailable");
  await tick(300);
  assert.equal(camera.runs, 1);
});

test("no camera, or ADP_PREVIEW=off, serves no stream and starts no capture", async (t) => {
  const camera = fakeCamera();
  for (const [options, status] of [
    [{ ready: () => false }, "none"],
    [{ ready: () => true, enabled: false }, "disabled"],
  ]) {
    const preview = new CameraPreview({ allowed: () => true, capture: camera.capture, ...options });
    const { origin, state } = await kiosk(t, { preview });
    assert.equal((await state()).preview, status);
    assert.equal((await fetch(origin + "/preview")).status, 404);
  }
  assert.equal(camera.runs, 0);
});

test("the page loads nothing from outside the device", async (t) => {
  const { origin } = await kiosk(t);
  const font = await fetch(origin + "/outfit.woff2");
  assert.equal(font.headers.get("content-type"), "font/woff2");
  assert.equal(Buffer.from(await font.arrayBuffer()).toString("latin1", 0, 4), "wOF2");
  for (const name of ["index.html", "screen.css", "screen.js"]) {
    const source = readFileSync(new URL("../apps/display/" + name, import.meta.url), "utf8");
    // SVG namespaces would be fine, but this page has none: inline SVG in HTML needs no xmlns
    assert.doesNotMatch(source, /https?:\/\//, name);
  }
});

test("a device shows the label its controller sends, and refuses a bad one", async (t) => {
  const { DisplayState } = await import("../apps/display/server.mjs");
  const { bridge } = await import("../clients/linux/server.mjs");
  const { identity, publishActivity } = await import("../packages/sdk/index.mjs");
  const { once } = await import("node:events");
  const owner = identity(),
    device = identity();
  const peer = { key: owner.key, assignedAgent: "pas-lola@host.local", revision: "one" };
  const display = new DisplayState(() => peer);
  const server = bridge(device, () => peer, undefined, display);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  const origin = "http://127.0.0.1:" + server.address().port;
  const send = (label) =>
    publishActivity(origin, owner, device.key, peer.assignedAgent, "idle", fetch, true, label);
  await send("Lola");
  assert.equal(display.read().label, "Lola");
  await assert.rejects(send("bad\nname"));
  await assert.rejects(send("x".repeat(65)));
  await send();
  assert.equal(display.read().label, "Lola");
});

test("a device shows who hears it, and forgets when the controller stops saying so", async (t) => {
  const { DisplayState } = await import("../apps/display/server.mjs");
  const { bridge } = await import("../clients/linux/server.mjs");
  const { identity, publishActivity } = await import("../packages/sdk/index.mjs");
  const { once } = await import("node:events");
  const owner = identity(),
    device = identity();
  const peer = { key: owner.key, assignedAgent: "pas-lola@host.local", revision: "one" };
  const display = new DisplayState(() => peer);
  const server = bridge(device, () => peer, undefined, display);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  const origin = "http://127.0.0.1:" + server.address().port;
  const send = (hearing) =>
    publishActivity(origin, owner, device.key, peer.assignedAgent, "idle", fetch, true, "Lola", hearing);
  await send("ElevenLabs");
  assert.equal(display.read().hearing, "ElevenLabs");
  await assert.rejects(send("bad\nname"));
  await send();
  assert.equal(display.read().hearing, null);
});

