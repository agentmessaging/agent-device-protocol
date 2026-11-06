import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  identity,
  call,
  seal,
  open,
  nonce,
  privateOrigin,
  localAddress,
} from "@ai-maestro/device-sdk";
import { bridge } from "../clients/linux/server.mjs";
import { announce } from "../apps/controller/announce.mjs";
const jpeg = { mime: "image/jpeg", data: "/9j/2Q==" };
async function setup(t) {
  const device = identity(),
    controller = identity();
  const policy = {
    assignedAgent: "lola@mini.aimaestro.local",
    key: controller.key,
    camera: false,
  };
  const hardware = {
    cameraReady: () => true,
    indicatorReady: () => true,
    indicate: async () => {},
    snapshot: async () => jpeg,
  };
  const server = bridge(device, () => ({ ...policy }), hardware);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const origin = "http://127.0.0.1:" + server.address().port;
  const invoke = (cap) => call(origin, controller, device.key, cap);
  const post = (packet) =>
    fetch(origin + "/v1/request", {
      method: "POST",
      body: JSON.stringify(packet),
    });
  const challenge = async () =>
    (await (await fetch(origin + "/v1/challenge")).json()).challenge;
  return {
    device,
    controller,
    policy,
    hardware,
    origin,
    invoke,
    post,
    challenge,
  };
}
test("signed registration and health over HTTP", async (t) => {
  const s = await setup(t);
  assert.deepEqual((await s.invoke()).capabilities, ["device.health"]);
  assert.equal((await s.invoke("device.health")).value.status, "ok");
});
test("policy changes and physical availability govern snapshots", async (t) => {
  const s = await setup(t);
  assert.equal((await s.invoke("camera.snapshot")).error, "denied");
  s.policy.camera = true;
  assert.deepEqual((await s.invoke("camera.snapshot")).value, jpeg);
  s.hardware.snapshot = async () => {
    throw Error("driver disconnected");
  };
  assert.equal(
    (await s.invoke("camera.snapshot")).error,
    "hardware_unavailable",
  );
  s.hardware.cameraReady = () => false;
  assert.deepEqual((await s.invoke()).capabilities, ["device.health"]);
});
test("shell, media streams and unrecognized arguments fail closed", async (t) => {
  const s = await setup(t);
  for (const cap of ["system.run", "microphone.stream", "speaker.play"])
    assert.equal((await s.invoke(cap)).error, "denied");
  const msg = {
    type: "invoke",
    to: s.device.key,
    capability: "device.health",
    args: { cmd: "id" },
    challenge: await s.challenge(),
    id: nonce(),
  };
  const response = await s.post(seal(msg, s.controller.secret));
  assert.equal(
    open(await response.json(), s.device.key).error,
    "invalid_arguments",
  );
});
test("tampering, unpaired callers, and wrong audience are rejected", async (t) => {
  const s = await setup(t);
  const msg = {
    type: "discover",
    id: nonce(),
    to: s.device.key,
    challenge: await s.challenge(),
  };
  const packet = seal(msg, s.controller.secret);
  packet.body = seal({ ...msg, id: nonce() }, s.controller.secret).body;
  assert.equal((await s.post(packet)).status, 403);
  assert.equal((await s.post(seal(msg, identity().secret))).status, 403);
  assert.equal(
    (await s.post(seal({ ...msg, to: s.controller.key }, s.controller.secret)))
      .status,
    403,
  );
});
test("concurrent replay executes exactly once", async (t) => {
  const s = await setup(t);
  let count = 0;
  s.policy.camera = true;
  s.hardware.snapshot = async () => {
    count++;
    return jpeg;
  };
  const packet = seal(
    {
      type: "invoke",
      capability: "camera.snapshot",
      id: nonce(),
      to: s.device.key,
      challenge: await s.challenge(),
    },
    s.controller.secret,
  );
  const responses = await Promise.all([s.post(packet), s.post(packet)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 403]);
  assert.equal(count, 1);
});
test("peer revocation takes effect before next invocation", async (t) => {
  const s = await setup(t);
  s.policy.key = identity().key;
  await assert.rejects(s.invoke("device.health"), /403/);
});
test("controller rejects forged device reply", async (t) => {
  const s = await setup(t);
  const fake = async (url) =>
    url.endsWith("challenge")
      ? Response.json({ challenge: nonce() })
      : Response.json(seal({}, identity().secret));
  await assert.rejects(
    call(s.origin, s.controller, s.device.key, undefined, fake),
    /signature/,
  );
});
test("only numeric loopback or tailnet origins are accepted", () => {
  for (const url of [
    "http://example.org",
    "http://192.168.1.1",
    "http://0.0.0.0",
    "http://100.128.0.1",
    "http://user@127.0.0.1",
  ])
    assert.throws(() => privateOrigin(url));
  assert.equal(localAddress("100.64.0.1"), true);
});
test("AMP announcement uses verified registration and fixed notification argv", async (t) => {
  const s = await setup(t);
  let sent;
  await announce(s.origin, "lola@mini.aimaestro.local", {
    controller: () => s.controller,
    device: () => s.device,
    send: async (...args) => {
      sent = args;
    },
  });
  assert.equal(sent[0], "amp-send");
  assert.deepEqual(JSON.parse(sent[1][2]).capabilities, ["device.health"]);
  assert.equal(JSON.parse(sent[1][2]).key, s.device.key);
});
test("one assigned agent controls discovery, hardware, and event routing", async (t) => {
  const s = await setup(t);
  const other = identity();
  s.policy.camera = true;
  assert.equal((await s.invoke()).assignedAgent, s.policy.assignedAgent);
  for (const capability of [undefined, "device.health", "camera.snapshot"])
    await assert.rejects(
      call(s.origin, other, s.device.key, capability),
      /403/,
    );
  await assert.rejects(
    announce(s.origin, "other@mini.aimaestro.local", {
      controller: () => s.controller,
      device: () => s.device,
      send: () => assert.fail("unexpected AMP send"),
    }),
    /restricted to the assigned agent/,
  );
  s.policy.assignedAgent = "other@mini.aimaestro.local";
  s.policy.key = other.key;
  await assert.rejects(s.invoke("device.health"), /403/);
  assert.equal(
    (await call(s.origin, other, s.device.key)).assignedAgent,
    s.policy.assignedAgent,
  );
  delete s.policy.assignedAgent;
  await assert.rejects(
    call(s.origin, other, s.device.key, "device.health"),
    /403/,
  );
});
test("transfer drains old capture and withholds its image before admitting new owner", async (t) => {
  const s = await setup(t);
  const next = identity();
  const started = Promise.withResolvers();
  const frame = Promise.withResolvers();
  s.policy.camera = true;
  s.hardware.snapshot = () => {
    started.resolve();
    return frame.promise;
  };
  const oldCapture = s.invoke("camera.snapshot");
  await started.promise;
  // The real policy reader returns a fresh record for each request.
  s.policy.assignedAgent = "next@mini.aimaestro.local";
  s.policy.key = next.key;
  try {
    await assert.rejects(
      call(s.origin, next, s.device.key, "device.health"),
      /409/,
    );
  } finally {
    frame.resolve(jpeg);
  }
  await assert.rejects(oldCapture, /403/);
  assert.equal(
    (await call(s.origin, next, s.device.key, "device.health")).ok,
    true,
  );
});
