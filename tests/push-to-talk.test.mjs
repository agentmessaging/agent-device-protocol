import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { identity } from "../packages/sdk/index.mjs";
import { ReverseHub, DeviceConnection } from "../packages/sdk/reverse.mjs";
import { PushToTalk } from "../clients/linux/talk.mjs";

const fakeDisplay = () => {
  const shown = [];
  return { shown, indicate: async (kind) => shown.push(kind), keepIndicator() {} };
};
function fakeCapture(bytes) {
  const state = { stopped: false, seconds: 0 };
  const capture = (kind, seconds, onData) => {
    state.kind = kind;
    state.seconds = seconds;
    onData(Buffer.alloc(bytes));
    return () => {
      state.stopped = true;
    };
  };
  return { capture, state };
}
const talker = (peer, bytes, sent) => {
  const { capture, state } = fakeCapture(bytes);
  const display = fakeDisplay();
  return {
    state,
    display,
    talk: new PushToTalk({ getPeer: () => peer, display, capture, send: async (a) => sent.push(a) }),
  };
};
const allowed = { media: { microphone: true } };

test("hold to talk records with the sign on, and release sends one WAV", async () => {
  const sent = [];
  const { talk, state, display } = talker(allowed, 32000, sent);
  await talk.start();
  assert.deepEqual(display.shown, ["microphone"]);
  assert.equal(state.kind, "microphone");
  assert.equal(state.seconds, 20);
  assert.equal(await talk.stop(), true);
  assert.equal(state.stopped, true);
  assert.equal(sent[0].toString("latin1", 0, 4), "RIFF");
});

test("no microphone grant, no recording", async () => {
  const sent = [];
  const { talk, state } = talker({ media: {} }, 32000, sent);
  await assert.rejects(talk.start(), /not allowed/);
  assert.equal(state.kind, undefined);
});

test("a slip of the finger sends nothing", async () => {
  const sent = [];
  const { talk } = talker(allowed, 800, sent);
  await talk.start();
  assert.equal(await talk.stop(), false);
  assert.equal(sent.length, 0);
});

test("stopping all media cancels a recording, and nothing is sent", async () => {
  const sent = [];
  const { talk, state } = talker(allowed, 32000, sent);
  await talk.start();
  talk.cancel();
  assert.equal(state.stopped, true);
  assert.equal(await talk.stop(), false);
  assert.equal(sent.length, 0);
});

test("a recording reaches the hub, and the device does not wait for transcription", async (t) => {
  const owner = identity(),
    device = identity();
  const heard = [];
  let finish;
  const hub = new ReverseHub({
    identity: owner,
    getDevices: () => ({ [device.key]: { agent: "lola@host.local" } }),
    onAudio: (key, audio) => {
      heard.push(audio);
      return new Promise((r) => (finish = r));
    },
  });
  hub.server.listen(0, "127.0.0.1");
  await once(hub.server, "listening");
  t.after(() => hub.close());
  const connection = new DeviceConnection({
    origin: "http://127.0.0.1:" + hub.server.address().port,
    identity: device,
    getPeer: () => ({ key: owner.key, assignedAgent: "lola@host.local" }),
    retryMinMs: 5,
    adapter: async () => ({ status: 200, body: {} }),
  });
  t.after(() => connection.stop());
  await connection.ready;
  await new Promise((r) => setTimeout(r, 20));
  const wavFile = Buffer.alloc(640000);
  wavFile.write("RIFF", 0, "latin1");
  wavFile.write("WAVE", 8, "latin1");
  await connection.audio(wavFile);
  assert.equal(heard[0].length, 640000);
  finish();
  await assert.rejects(connection.audio(Buffer.alloc(64)), /Invalid audio/);
});
