// S003: the encrypted home network connection (docs/wiki/specs/S003-encrypted-home-network-connection.md)
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import WebSocket from "ws";
import { identity, call, seal, open } from "../packages/sdk/index.mjs";
import { ReverseHub, DeviceConnection, boundedJson, homeAddress } from "../packages/sdk/reverse.mjs";
import { secureAccept, deriveKeys, SecureChannel, ephemeralKey, secureHello, secureFinish } from "../packages/sdk/secure.mjs";
import { bridge } from "../clients/linux/server.mjs";

const AGENT = "lola@host.local";
async function waitFor(condition) {
  const end = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > end) throw new Error("Timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function setup(t, { secure = true, isHome = () => true } = {}) {
  const owner = identity(),
    device = identity();
  const peer = { key: owner.key, assignedAgent: AGENT, camera: true };
  const inputs = [];
  const server = bridge(device, () => peer, {
    cameraReady: () => true,
    indicatorReady: () => true,
    indicate: async () => {},
    snapshot: async () => ({ mime: "image/jpeg", data: "/9j/2Q==" }),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const hub = new ReverseHub({
    identity: owner,
    getDevices: () => ({ [device.key]: { agent: AGENT } }),
    onInput: (key, text) => inputs.push(text),
    isHome,
  });
  hub.server.listen(0, "127.0.0.1");
  await once(hub.server, "listening");
  const origin = "http://127.0.0.1:" + hub.server.address().port;
  const connection = new DeviceConnection({
    origin,
    identity: device,
    getPeer: () => peer,
    retryMinMs: 20,
    retryMaxMs: 100,
    secure,
    adapter: async (method, body, signal) => {
      const r = await fetch("http://127.0.0.1:" + server.address().port + "/v1/" + method, {
        signal,
        method: method === "challenge" ? "GET" : "POST",
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, body: await boundedJson(r) };
    },
  });
  t.after(async () => {
    await connection.stop();
    await hub.close();
    server.close();
    server.closeAllConnections();
  });
  await connection.ready;
  return { owner, device, hub, connection, origin, inputs };
}

test("an encrypted connection from a home network carries the whole profile", async (t) => {
  const s = await setup(t);
  const endpoint = { reverse: s.origin };
  assert.ok(s.hub.connections.get(s.device.key).adpChannel, "the hub side is encrypted");
  assert.equal((await call(endpoint, s.owner, s.device.key)).assignedAgent, AGENT);
  assert.equal((await call(endpoint, s.owner, s.device.key, "camera.snapshot")).value.data, "/9j/2Q==");
  await waitFor(() => s.connection.eventChallenge);
  await s.connection.input("Hello Lola");
  await waitFor(() => s.inputs.length === 1);
  assert.deepEqual(s.inputs, ["Hello Lola"]);
});

test("a plain connection from a home network gets only health and screen text, and no input", async (t) => {
  const s = await setup(t, { secure: false });
  const endpoint = { reverse: s.origin };
  assert.equal((await call(endpoint, s.owner, s.device.key, "device.health")).value.status, "ok");
  await assert.rejects(call(endpoint, s.owner, s.device.key, "camera.snapshot"));
  const sock = s.hub.connections.get(s.device.key);
  await waitFor(() => s.connection.eventChallenge);
  const closed = once(sock, "close");
  await assert.rejects(s.connection.input("Hello Lola"));
  await closed;
  assert.equal(s.inputs.length, 0);
});

test("a plain connection from loopback or Tailscale is not limited", async (t) => {
  const s = await setup(t, { secure: false, isHome: () => false });
  assert.equal((await call({ reverse: s.origin }, s.owner, s.device.key, "camera.snapshot")).value.data, "/9j/2Q==");
});

/** A hand-made device: does the key exchange itself, so a test can change what it sends */
async function rawDevice(t, { assignedAgent = AGENT, signer, peerEphemeral } = {}) {
  const owner = identity(),
    device = identity();
  const hub = new ReverseHub({ identity: owner, getDevices: () => ({ [device.key]: { agent: AGENT } }), isHome: () => true });
  hub.server.listen(0, "127.0.0.1");
  await once(hub.server, "listening");
  t.after(() => hub.close());
  const ws = new WebSocket(`ws://127.0.0.1:${hub.server.address().port}/v1/secure/${device.key}`);
  const [hello] = await once(ws, "message");
  const helloPacket = JSON.parse(hello.toString());
  const m = open(helloPacket, owner.key);
  assert.equal(m.type, "secure.hello");
  const eph = ephemeralKey();
  const accept = seal(
    { type: "secure.accept", version: 1, id: m.id, challenge: m.challenge, to: owner.key, assignedAgent, ephemeral: eph.public, peerEphemeral: peerEphemeral ?? m.ephemeral },
    (signer ?? device).secret,
  );
  return { ws, owner, device, helloPacket, accept, eph };
}

test("a key exchange signed by another key, for another ephemeral key or another agent is refused", async (t) => {
  for (const options of [{ signer: identity() }, { peerEphemeral: ephemeralKey().public }]) {
    const d = await rawDevice(t, options);
    const closed = once(d.ws, "close");
    d.ws.send(JSON.stringify(d.accept));
    await closed;
  }
  const d = await rawDevice(t, { assignedAgent: "other@host.local" });
  const closed = once(d.ws, "close");
  d.ws.send(JSON.stringify(d.accept));
  const [code, reason] = await closed;
  assert.equal(code, 4003);
  assert.equal(reason.toString(), "not_owner");
});

test("a changed, replayed or plain message on the encrypted connection closes it", async (t) => {
  for (const attack of ["change", "replay", "plain"]) {
    const d = await rawDevice(t);
    const accept = secureAccept(d.helloPacket, { controllerKey: d.owner.key, identity: d.device, assignedAgent: AGENT });
    d.ws.send(JSON.stringify(accept.packet));
    const [first, isBinary] = await once(d.ws, "message");
    assert.equal(isBinary, true, "the plain profile now arrives encrypted");
    assert.equal(JSON.parse(accept.channel.open(first, true)).type, "hello");
    const closed = once(d.ws, "close");
    const frame = accept.channel.seal(JSON.stringify({ type: "noise" }));
    if (attack === "change") {
      frame[0] ^= 1;
      d.ws.send(frame);
    } else if (attack === "replay") {
      const good = accept.channel.seal(JSON.stringify({ type: "x" }));
      d.ws.send(good);
      d.ws.send(good);
    } else d.ws.send(JSON.stringify({ type: "connect" }));
    await closed;
  }
});

test("the test vectors give the published keys and first message", () => {
  const v = JSON.parse(readFileSync(new URL("./vectors/secure-v1.json", import.meta.url)));
  const controller = ephemeralKey(Buffer.from(v.controllerEphemeralSecret, "hex"));
  const device = ephemeralKey(Buffer.from(v.deviceEphemeralSecret, "hex"));
  assert.equal(controller.public, v.controllerEphemeral);
  assert.equal(device.public, v.deviceEphemeral);
  const keys = deriveKeys(Buffer.from(v.shared, "hex"), Buffer.from(v.helloBody), Buffer.from(v.acceptBody));
  assert.equal(keys.controllerToDevice.toString("hex"), v.controllerToDevice);
  assert.equal(keys.deviceToController.toString("hex"), v.deviceToController);
  const channel = new SecureChannel(keys.controllerToDevice, keys.deviceToController);
  assert.equal(channel.seal(v.firstPlaintext).toString("hex"), v.firstCiphertext);
});

test("only private IPv4 ranges count as a home network", () => {
  for (const a of ["10.0.0.223", "172.16.0.1", "172.31.255.1", "192.168.1.5", "::ffff:192.168.1.5"]) assert.ok(homeAddress(a), a);
  for (const a of ["100.88.157.63", "127.0.0.1", "172.32.0.1", "8.8.8.8", "fe80::1", ""]) assert.ok(!homeAddress(a), a);
});

test("the key exchange checks every field of the hello", () => {
  const c = identity(), d = identity();
  const { packet } = secureHello(c.secret, d.key);
  assert.throws(() => secureAccept(packet, { controllerKey: identity().key, identity: d, assignedAgent: AGENT }));
  assert.throws(() => secureAccept(packet, { controllerKey: c.key, identity: identity(), assignedAgent: AGENT }));
  const tampered = seal({ ...open(packet, c.key), version: 2 }, c.secret);
  assert.throws(() => secureAccept(tampered, { controllerKey: c.key, identity: d, assignedAgent: AGENT }));
  const { packet: p2, state } = secureHello(c.secret, d.key);
  const a = secureAccept(p2, { controllerKey: c.key, identity: d, assignedAgent: AGENT });
  assert.ok(secureFinish(state, a.packet, { deviceKey: d.key, controllerKey: c.key, assignedAgent: AGENT }));
});
