import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { MediaManager, runCapture } from "../clients/linux/media.mjs";
import { DisplayState, displayServer } from "../apps/display/server.mjs";
import { bridge } from "../clients/linux/server.mjs";
import { identity, call, exchange } from "@ai-maestro/device-sdk";
import { streamMedia, wav } from "../packages/sdk/media.mjs";
import { executeTool } from "../apps/controller/tools.mjs";
import { transition, monitorOnce } from "../apps/controller/monitor.mjs";

async function start(t, server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      }),
  );
  return "http://127.0.0.1:" + server.address().port;
}
async function setup(t) {
  const controller = identity(),
    device = identity();
  let peer = {
    key: controller.key,
    assignedAgent: "lola@mini.local",
    camera: true,
    media: { video: true, microphone: true, speaker: true },
  };
  let stops = 0;
  const hardware = {
    mediaAvailable: () => true,
    captureMedia(kind, seconds, onData, onEnd) {
      const timer = setInterval(
        () =>
          onData(
            kind === "video"
              ? Buffer.from([255, 216, 1, 255, 217])
              : Buffer.alloc(3200),
          ),
        20,
      );
      const end = setTimeout(() => onEnd(), seconds * 1000);
      return () => {
        clearInterval(timer);
        clearTimeout(end);
        stops++;
      };
    },
    playPCM(data, onEnd) {
      const timer = setTimeout(() => onEnd(), 20);
      return () => clearTimeout(timer);
    },
  };
  const display = new DisplayState(() => peer);
  const manager = new MediaManager(() => peer, display, hardware);
  const server = bridge(device, () => peer, undefined, display, manager);
  const origin = await start(t, server);
  t.after(() => manager.stopAll());
  return {
    controller,
    device,
    origin,
    manager,
    display,
    get peer() {
      return peer;
    },
    set peer(p) {
      peer = p;
    },
    get stops() {
      return stops;
    },
  };
}
test("signed live video and audio are consumed by fixed agent tools", async (t) => {
  const s = await setup(t);
  const definition = {
    agent: s.peer.assignedAgent,
    devices: { macbook: { origin: s.origin, key: s.device.key } },
  };
  const deps = {
    config: () => definition,
    self: () => s.controller,
    call,
    exchange,
    streamMedia,
  };
  const tools = await executeTool("device_list", {}, undefined, deps);
  assert.equal(JSON.parse(tools.content[0].text)[0].online, true);
  const picture = await executeTool(
    "device_camera_live",
    { device: "macbook", seconds: 1 },
    undefined,
    deps,
  );
  assert.equal(picture.content[0].type, "image");
  const audio = await executeTool(
    "device_microphone",
    { device: "macbook", seconds: 1 },
    undefined,
    deps,
  );
  assert.equal(
    Buffer.from(audio.content[0].data, "base64").toString("ascii", 0, 4),
    "RIFF",
  );
  const result = await executeTool(
    "device_speaker",
    { device: "macbook", pcm: Buffer.alloc(320).toString("base64") },
    undefined,
    deps,
  );
  assert.equal(JSON.parse(result.content[0].text).played, true);
  await assert.rejects(
    executeTool(
      "device_health",
      { device: "macbook", command: "id" },
      undefined,
      deps,
    ),
    /Unknown/,
  );
  await assert.rejects(
    executeTool("device_health", { device: "other" }, undefined, deps),
    /Unknown device/,
  );
});
test("revocation and transfer stop active capture, hide PiP and deny old owner", async (t) => {
  for (const transfer of [false, true]) {
    const s = await setup(t);
    const stream = streamMedia(
      s.origin,
      s.controller,
      s.device.key,
      "video",
      5,
    );
    const frame = await stream.next();
    assert.equal(frame.value.kind, "video");
    assert.ok(s.display.read().live.includes("video"));
    s.peer = transfer
      ? { ...s.peer, key: identity().key, assignedAgent: "other@mini.local" }
      : { ...s.peer, media: { video: false } };
    await assert.rejects(async () => {
      for await (const frame of stream) {
      }
    }, /revoked/);
    assert.equal(s.manager.active().length, 0);
    assert.equal(s.display.read().frameAt, null);
    assert.ok(s.stops > 0);
    await assert.rejects(async () => {
      for await (const frame of streamMedia(
        s.origin,
        s.controller,
        s.device.key,
        "video",
        1,
      )) {
      }
    }, /403/);
  }
});
test("disconnect cancels capture and releases the camera", async (t) => {
  const s = await setup(t);
  const stream = streamMedia(s.origin, s.controller, s.device.key, "video", 5);
  await stream.next();
  await stream.return();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(s.manager.active().length, 0);
  assert.equal(s.stops, 1);
});
test("local consent requires the display origin and token; stop revokes all streams", async (t) => {
  const s = await setup(t);
  const origin = await start(
    t,
    displayServer(s.display, {
      setConsent: (media) => {
        s.peer = { ...s.peer, media };
      },
      stopAll: () => s.manager.stopAll(),
    }),
  );
  const state = await (await fetch(origin + "/state")).json();
  assert.equal(
    (await fetch(origin + "/consent", { method: "POST", body: "{}" })).status,
    403,
  );
  const result = await fetch(origin + "/stop", {
    method: "POST",
    headers: { Origin: origin, "X-Display-Token": state.controlToken },
    body: "{}",
  });
  assert.equal(result.status, 204);
  assert.deepEqual(s.peer.media, {
    video: false,
    microphone: false,
    speaker: false,
  });
});
test("liveness transitions and notices survive a monitor restart", async () => {
  const stored = {};
  let online = true,
    sends = 0;
  const deps = {
    config: () => ({
      agent: "lola@mini.local",
      devices: { macbook: { origin: "http://127.0.0.1", key: "key" } },
    }),
    self: () => ({}),
    load: (name, fallback) => structuredClone(stored[name] ?? fallback),
    save: (name, value) => {
      stored[name] = structuredClone(value);
    },
    call: async (_origin, _self, _key, cap) => {
      if (!online) throw new Error("Unavailable");
      return cap
        ? { ok: true, value: { platform: "linux" } }
        : { assignedAgent: "lola@mini.local", capabilities: [], streams: [] };
    },
    notify: async () => {
      sends++;
    },
  };
  await monitorOnce(deps);
  await monitorOnce(deps);
  assert.equal(sends, 1);
  online = false;
  await monitorOnce(deps);
  await monitorOnce(deps);
  await monitorOnce(deps);
  assert.equal(sends, 2);
  assert.equal(stored["device-status.json"].devices.macbook.state, "offline");
  assert.equal(
    transition({}, { revoked: true, online: false }, "now").state,
    "revoked",
  );
});

test("capture adapter rejects oversized camera frames and emits bounded PCM", async () => {
  await new Promise((resolve, reject) => {
    runCapture(
      [
        "-e",
        "process.stdout.write(Buffer.concat([Buffer.from([255,216]),Buffer.alloc(600000)]));setTimeout(()=>{},10000)",
      ],
      "video",
      () => reject(new Error("Oversized camera frame escaped")),
      (reason) => {
        try {
          assert.equal(reason, "hardware_unavailable");
          resolve();
        } catch (error) {
          reject(error);
        }
      },
      process.execPath,
    );
  });
  const chunks = [];
  await new Promise((resolve) =>
    runCapture(
      ["-e", "process.stdout.write(Buffer.alloc(9600))"],
      "microphone",
      (data) => chunks.push(data),
      resolve,
      process.execPath,
    ),
  );
  assert.deepEqual(
    chunks.map((c) => c.length),
    [3200, 3200, 3200],
  );
});
