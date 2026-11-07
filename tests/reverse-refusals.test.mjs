import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { identity } from "../packages/sdk/index.mjs";
import { ReverseHub, DeviceConnection } from "../packages/sdk/reverse.mjs";
import { WebSocket } from "ws";

async function hubFor(t, getDevices, owner = identity()) {
  const refused = [];
  const hub = new ReverseHub({ identity: owner, getDevices, heartbeatMs: 20 });
  hub.on("refused", (r) => refused.push(r.reason));
  hub.server.listen(0, "127.0.0.1");
  await once(hub.server, "listening");
  t.after(() => hub.close());
  return { hub, refused, owner, origin: "http://127.0.0.1:" + hub.server.address().port };
}
function connect(t, origin, device, owner, agent = "lola@host.local") {
  const connection = new DeviceConnection({
    origin,
    identity: device,
    getPeer: () => ({ key: owner.key, assignedAgent: agent }),
    retryMinMs: 5,
    retryMaxMs: 10,
    adapter: async () => ({ status: 200, body: {} }),
  });
  t.after(() => connection.stop());
  return connection;
}

test("an unknown device stops after a few tries, and says why", async (t) => {
  const { origin, refused, owner } = await hubFor(t, () => ({}));
  const connection = connect(t, origin, identity(), owner);
  const [reason] = await once(connection, "stopped");
  assert.equal(reason, "unknown_device");
  assert.equal(refused.length, 3);
  await connection.done;
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(refused.length, 3);
});

test("a device that names another agent stops", async (t) => {
  const device = identity();
  const { origin, owner, refused } = await hubFor(t, () => ({ [device.key]: { agent: "other@host.local" } }));
  const connection = connect(t, origin, device, owner);
  assert.deepEqual(await once(connection, "stopped"), ["not_owner"]);
  assert.equal(refused[0], "not_owner");
});

test("a device removed while connected stops", async (t) => {
  const device = identity();
  let devices = { [device.key]: { agent: "lola@host.local" } };
  const { origin, owner } = await hubFor(t, () => devices);
  const connection = connect(t, origin, device, owner);
  await once(connection, "connected");
  devices = {};
  assert.deepEqual(await once(connection, "stopped"), ["unknown_device"]);
});

test("an assignment completed during the first tries still connects", async (t) => {
  const device = identity();
  let devices = {};
  const { hub, origin, owner } = await hubFor(t, () => devices);
  hub.once("refused", () => {
    devices = { [device.key]: { agent: "lola@host.local" } };
  });
  const connection = connect(t, origin, device, owner);
  await once(connection, "connected");
  assert.equal(connection.stopped, undefined);
});

test("a controller that is down is temporary: the device keeps trying and connects when it returns", async (t) => {
  const device = identity();
  const first = await hubFor(t, () => ({ [device.key]: { agent: "lola@host.local" } }));
  const port = first.hub.server.address().port;
  await first.hub.close();
  const connection = connect(t, first.origin, device, first.owner);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(connection.stopped, undefined);
  const hub = new ReverseHub({ identity: first.owner, getDevices: () => ({ [device.key]: { agent: "lola@host.local" } }) });
  hub.server.listen(port, "127.0.0.1");
  t.after(() => hub.close());
  await once(connection, "connected");
});

function socketWith(t, origin, device, options) {
  const ws = new WebSocket(origin.replace("http", "ws") + "/v1/connect/" + device.key, options);
  t.after(() => ws.terminate());
  return ws;
}

test("a phone's socket, which sends the hub's own origin, gets the handshake", async (t) => {
  const device = identity();
  const { origin } = await hubFor(t, () => ({ [device.key]: { agent: "lola@host.local" } }));
  const [hello] = await once(socketWith(t, origin, device, { origin }), "message");
  assert.equal(JSON.parse(hello).type, "hello");
});

test("a web page is dropped and logged, even under a domain that points at the hub", async (t) => {
  const device = identity();
  const { origin, refused } = await hubFor(t, () => ({ [device.key]: { agent: "lola@host.local" } }));
  const port = new URL(origin).port;
  for (const options of [
    { origin: "https://evil.example" },
    { origin: "http://evil.example:" + port, headers: { Host: "evil.example:" + port } },
  ]) {
    await once(socketWith(t, origin, device, options), "error");
  }
  assert.deepEqual(refused, ["origin", "origin"]);
});
