import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { identity, exchange } from "../packages/sdk/index.mjs";
import { bridge } from "../clients/linux/server.mjs";

const wav = (size) => {
  const bytes = Buffer.alloc(size);
  bytes.write("RIFF", 0, "latin1");
  bytes.write("WAVE", 8, "latin1");
  return bytes.toString("base64");
};

async function setup(t, outputs, ready = true) {
  const owner = identity(),
    device = identity(),
    played = [];
  const peer = { key: owner.key, assignedAgent: "lola@host.local", revision: "one", outputs };
  const server = bridge(device, () => peer, {
    cameraReady: () => false,
    playReady: () => ready,
    play: async (bytes) => {
      played.push(bytes);
      return { played: true };
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    played,
    invoke: (args) =>
      exchange(origin, owner, device.key, { type: "invoke", capability: "speaker.play", args }, "result"),
  };
}

test("speaker.play plays WAV audio up to 384 KiB", async (t) => {
  const { invoke, played } = await setup(t, { "speaker.play": true });
  assert.deepEqual((await invoke({ mime: "audio/wav", data: wav(44) })).value, { played: true });
  assert.equal((await invoke({ mime: "audio/wav", data: wav(393216) })).ok, true);
  assert.equal(played.at(-1).length, 393216);
});

test("speaker.play refuses anything else, and plays nothing", async (t) => {
  const { invoke, played } = await setup(t, { "speaker.play": true });
  const bad = [
    { mime: "audio/mpeg", data: wav(44) },
    { mime: "audio/wav", data: Buffer.alloc(64).toString("base64") },
    { mime: "audio/wav", data: wav(393217) },
    { mime: "audio/wav", data: "not base64" },
    { mime: "audio/wav", data: wav(44), url: "file:///etc/passwd" },
  ];
  for (const args of bad) assert.equal((await invoke(args)).error, "invalid_arguments");
  assert.equal(played.length, 0);
});

test("the speaker.say grant does not allow speaker.play", async (t) => {
  const { invoke, played } = await setup(t, { "speaker.say": true });
  assert.equal((await invoke({ mime: "audio/wav", data: wav(44) })).error, "denied");
  assert.equal(played.length, 0);
});

test("a device that cannot play audio does not offer it", async (t) => {
  const { invoke } = await setup(t, { "speaker.play": true }, false);
  assert.equal((await invoke({ mime: "audio/wav", data: wav(44) })).error, "denied");
});
