import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { identity, call, seal, nonce } from "../packages/sdk/index.mjs";
import {
  ReverseHub,
  DeviceConnection,
  boundedJson,
} from "../packages/sdk/reverse.mjs";
import { bridge } from "../clients/linux/server.mjs";
async function waitFor(condition) {
  const end = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > end) throw new Error("Timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
async function setup(t) {
  const owner = identity(),
    device = identity();
  let peer = { key: owner.key, assignedAgent: "lola@host.local", camera: true };
  let used = 0;
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
    getDevices: () => ({ [device.key]: { agent: "lola@host.local" } }),
    onUsed: () => {
      used++;
    },
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
    adapter: async (method, body, signal) => {
      const result = await fetch(
        "http://127.0.0.1:" + server.address().port + "/v1/" + method,
        {
          signal,
          method: method === "challenge" ? "GET" : "POST",
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      return { status: result.status, body: await boundedJson(result) };
    },
  });
  t.after(async () => {
    await connection.stop();
    await hub.close();
    server.close();
    server.closeAllConnections();
  });
  await connection.ready;
  return {
    owner,
    device,
    hub,
    connection,
    origin,
    get used() {
      return used;
    },
    set peer(p) {
      peer = p;
    },
  };
}
test("outbound connection authenticates both pins and carries the same discovery and invocation", async (t) => {
  const s = await setup(t),
    endpoint = { reverse: s.origin };
  const registration = await call(endpoint, s.owner, s.device.key);
  assert.equal(registration.assignedAgent, "lola@host.local");
  const result = await call(endpoint, s.owner, s.device.key, "camera.snapshot");
  assert.equal(result.value.data, "/9j/2Q==");
  await waitFor(() => s.connection.eventChallenge);
  await s.connection.used();
  await waitFor(() => s.used === 1);
  s.peer = {
    key: identity().key,
    assignedAgent: "new@host.local",
    camera: false,
  };
  await waitFor(() => !s.hub.connections.size);
  await assert.rejects(
    call(endpoint, s.owner, s.device.key, "device.health"),
    /503/,
  );
});
test("unknown device key and forged device events are rejected", async (t) => {
  const s = await setup(t);
  const stranger = new WebSocket(
    s.origin.replace("http:", "ws:") + "/v1/connect/" + identity().key,
  );
  stranger.on("error", () => {});
  await new Promise((resolve) => stranger.on("close", resolve));
  assert.equal(s.hub.connections.size, 1);
  await waitFor(() => s.connection.eventChallenge);
  const closed = once(s.connection, "disconnected");
  s.connection.socket.send(
    JSON.stringify(
      seal(
        {
          type: "device.used",
          id: nonce(),
          challenge: s.connection.eventChallenge,
          to: s.owner.key,
          assignedAgent: "lola@host.local",
        },
        identity().secret,
      ),
    ),
  );
  await closed;
  assert.equal(s.used, 0);
});

test("a handshake proof cannot be replayed on a new connection", async (t) => {
  const owner = identity(),
    device = identity();
  const hub = new ReverseHub({
    identity: owner,
    getDevices: () => ({ [device.key]: { agent: "lola@host.local" } }),
  });
  hub.server.listen(0, "127.0.0.1");
  await once(hub.server, "listening");
  t.after(() => hub.close());
  const connect = () =>
    new WebSocket(
      "ws://127.0.0.1:" +
        hub.server.address().port +
        "/v1/connect/" +
        device.key,
    );
  const first = connect();
  first.on("error", () => {});
  const hello = JSON.parse((await once(first, "message"))[0]);
  const proof = seal(
    {
      type: "connect",
      id: nonce(),
      challenge: hello.challenge,
      to: owner.key,
      deviceChallenge: nonce(),
      assignedAgent: "lola@host.local",
    },
    device.secret,
  );
  const accepted = once(first, "message");
  first.send(JSON.stringify(proof));
  await accepted;
  first.terminate();
  await new Promise((r) => first.on("close", r));
  const second = connect();
  second.on("error", () => {});
  await once(second, "message");
  const closed = new Promise((r) => second.on("close", r));
  second.send(JSON.stringify(proof));
  await closed;
  assert.equal(hub.connections.size, 0);
});

test("signed input activates an idle device and is delivered only to its assigned agent", async (t) => {
  const { Controller } = await import("../packages/sdk/controller.mjs");
  const events = [];
  const c = new Controller({ onEvent: (e) => events.push(e) }),
    owner = identity(),
    other = identity();
  c.addAgent({ address: "lola@host.local", identity: owner });
  c.addAgent({ address: "other@host.local", identity: other });
  const hub = c.createHub();
  hub.server.listen(0, "127.0.0.1");
  await once(hub.server, "listening");
  const origin = "http://127.0.0.1:" + hub.server.address().port;
  const connections = [];
  t.after(async () => {
    await Promise.all(connections.map((d) => d.connection.stop()));
    await c.stop();
    for (const d of connections) {
      d.server.close();
      d.server.closeAllConnections();
    }
  });
  for (let i = 0; i < 3; i++) {
    const currentOwner = i === 2 ? other : owner,
      address = i === 2 ? "other@host.local" : "lola@host.local";
    const device = identity(),
      server = bridge(device, () => ({
        key: currentOwner.key,
        assignedAgent: address,
      }));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    c.pinDevice(address, {
      key: device.key,
      endpoint: { reverse: origin },
      name: "device" + i,
    });
    const connection = new DeviceConnection({
      origin,
      identity: device,
      getPeer: () => ({ key: currentOwner.key, assignedAgent: address }),
      adapter: async (method, body, signal) => {
        const res = await fetch(
          "http://127.0.0.1:" + server.address().port + "/v1/" + method,
          {
            signal,
            method: method === "challenge" ? "GET" : "POST",
            ...(body ? { body: JSON.stringify(body) } : {}),
          },
        );
        return { status: res.status, body: await boundedJson(res) };
      },
    });
    connections.push({ device, server, connection });
    await connection.ready;
  }
  await waitFor(() => c.inventory("lola@host.local").every((d) => d.verified));
  c.jump("lola@host.local", connections[0].device.key);
  await waitFor(() => connections[1].connection.eventChallenge);
  await connections[1].connection.input("Hello from the kitchen");
  const input = events.find((e) => e.type === "device.input");
  assert.equal(input.agent, "lola@host.local");
  assert.equal(input.deviceKey, connections[1].device.key);
  assert.equal(input.source, "device");
  assert.deepEqual(
    c
      .inventory("lola@host.local")
      .filter((d) => d.active)
      .map((d) => d.key),
    [connections[1].device.key],
  );
  assert.equal(c.inventory("other@host.local").length, 1);
  assert.equal(c.inventory("other@host.local")[0].active, false);
  await assert.rejects(
    connections[1].connection.input("x".repeat(4097)),
    /4096/,
  );
});

test("a locally approved transfer delivers its signed receipt before closing the former connection", async (t) => {
  const { Controller } = await import("../packages/sdk/controller.mjs");
  const { Proposals } = await import("../clients/linux/proposals.mjs");
  const owner = identity(),
    next = identity(),
    device = identity(),
    c = new Controller();
  c.addAgent({ address: "lola@host.local", identity: owner });
  let peer = {
      key: owner.key,
      assignedAgent: "lola@host.local",
      revision: "one",
    },
    stored;
  const proposals = new Proposals(
    () => peer,
    () => stored,
    (p) => {
      stored = p;
    },
    (change) => {
      peer = { key: change.key, assignedAgent: change.agent, revision: "two" };
    },
  );
  const server = bridge(
    device,
    () => peer,
    undefined,
    undefined,
    undefined,
    proposals,
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const hub = c.createHub();
  hub.server.listen(0, "127.0.0.1");
  await once(hub.server, "listening");
  const origin = "http://127.0.0.1:" + hub.server.address().port;
  c.pinDevice("lola@host.local", {
    key: device.key,
    endpoint: { reverse: origin },
  });
  const connection = new DeviceConnection({
    origin,
    identity: device,
    getPeer: () => peer,
    adapter: async (method, body, signal) => {
      const res = await fetch(
        "http://127.0.0.1:" + server.address().port + "/v1/" + method,
        {
          signal,
          method: method === "challenge" ? "GET" : "POST",
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      return { status: res.status, body: await boundedJson(res) };
    },
  });
  t.after(async () => {
    await connection.stop();
    await c.stop();
    server.close();
    server.closeAllConnections();
  });
  await connection.ready;
  await waitFor(() => c.inventory("lola@host.local")[0].verified);
  c.jump("lola@host.local", device.key);
  const requestId = nonce(),
    change = { action: "transfer", agent: "next@host.local", key: next.key };
  assert.equal(
    (
      await c.propose("lola@host.local", device.key, change, {
        requestId,
        expectedRevision: "one",
      })
    ).status,
    "awaiting_local_approval",
  );
  proposals.decide(requestId, true);
  await connection.finishProposal(proposals.receipt());
  await waitFor(() => !hub.connections.size);
  const receipt = await c.propose("lola@host.local", device.key, change, {
    requestId,
  });
  assert.equal(receipt.status, "confirmed");
  assert.equal(receipt.assignedAgent, "next@host.local");
  assert.equal(receipt.revision, "two");
  assert.equal(c.inventory("lola@host.local")[0].active, false);
});

test("disconnect during capture cancels the result and reconnect never repeats the capture", async (t) => {
  const owner = identity(),
    device = identity();
  let captures = 0,
    release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const server = bridge(
    device,
    () => ({ key: owner.key, assignedAgent: "lola@host.local", camera: true }),
    {
      cameraReady: () => true,
      indicatorReady: () => true,
      indicate: async () => {},
      snapshot: async () => {
        captures++;
        return pending;
      },
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const hub = new ReverseHub({
    identity: owner,
    getDevices: () => ({ [device.key]: { agent: "lola@host.local" } }),
  });
  hub.server.listen(0, "127.0.0.1");
  await once(hub.server, "listening");
  const origin = "http://127.0.0.1:" + hub.server.address().port;
  const connection = new DeviceConnection({
    origin,
    identity: device,
    getPeer: () => ({ key: owner.key, assignedAgent: "lola@host.local" }),
    retryMinMs: 20,
    retryMaxMs: 50,
    adapter: async (method, body, signal) => {
      const res = await fetch(
        "http://127.0.0.1:" + server.address().port + "/v1/" + method,
        {
          signal,
          method: method === "challenge" ? "GET" : "POST",
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      return { status: res.status, body: await boundedJson(res) };
    },
  });
  t.after(async () => {
    release({ mime: "image/jpeg", data: "/9j/2Q==" });
    await connection.stop();
    await hub.close();
    server.close();
    server.closeAllConnections();
  });
  await connection.ready;
  const failed = assert.rejects(
    call({ reverse: origin }, owner, device.key, "camera.snapshot"),
    /503|disconnect|fetch/,
  );
  await waitFor(() => captures === 1);
  const disconnected = once(connection, "disconnected");
  hub.connections.get(device.key).terminate();
  await disconnected;
  await failed;
  release({ mime: "image/jpeg", data: "/9j/2Q==" });
  await waitFor(() => connection.connected);
  assert.equal(
    (await call({ reverse: origin }, owner, device.key, "device.health")).ok,
    true,
  );
  assert.equal(captures, 1);
});
