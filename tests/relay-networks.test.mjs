// S006 (a relay listener) and S005 (network capabilities) in the SDK
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { identity } from "../packages/sdk/index.mjs";
import { ReverseHub, DeviceConnection, secureOrigin } from "../packages/sdk/reverse.mjs";
import { builtinCapabilities, validateArguments } from "../packages/sdk/capabilities.mjs";

async function relayHub(t, devices) {
  const refused = [];
  // isHome says yes to everything: a relay must ignore it, as the tunnel connects from loopback
  const hub = new ReverseHub({ identity: identity(), getDevices: () => devices, relay: true, isHome: () => true });
  hub.on("refused", (r) => refused.push(r.reason));
  hub.server.listen(0, "127.0.0.1");
  await once(hub.server, "listening");
  t.after(() => hub.close());
  return { hub, refused, origin: "http://127.0.0.1:" + hub.server.address().port };
}
function device(t, origin, me, hub, secure) {
  const c = new DeviceConnection({
    origin,
    secure,
    identity: me,
    getPeer: () => ({ key: hub.getIdentity().key, assignedAgent: "bruce@host.local" }),
    retryMinMs: 5,
    retryMaxMs: 10,
    finalAttempts: 1,
    adapter: async () => ({ status: 200, body: {} }),
  });
  t.after(() => c.stop());
  return c;
}

test("a relay listener refuses a plain connection, even from loopback", async (t) => {
  const me = identity();
  const { hub, origin, refused } = await relayHub(t, { [me.key]: { agent: "bruce@host.local" } });
  const c = device(t, origin, me, hub, false);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(c.connected, false);
  assert.ok(refused.includes("secure_only"));
});

test("a relay listener accepts the encrypted connection, with no home network limits", async (t) => {
  const me = identity();
  const { hub, origin } = await relayHub(t, { [me.key]: { agent: "bruce@host.local" } });
  device(t, origin, me, hub, true);
  await once(hub, "connected");
  const [ws] = hub.wss.clients;
  assert.equal(ws.adpLimited, false);
});

test("an encrypted connection may use an HTTPS name (a relay), but not a public IP or a path", () => {
  assert.equal(secureOrigin("https://devices.example.com"), "https://devices.example.com");
  assert.equal(secureOrigin("https://devices.example.com:8443/"), "https://devices.example.com:8443");
  assert.throws(() => secureOrigin("https://8.8.8.8"));
  assert.throws(() => secureOrigin("https://devices.example.com/v1"));
  assert.throws(() => secureOrigin("https://user:pw@devices.example.com"));
  assert.throws(() => secureOrigin("http://devices.example.com"));
});

test("network capabilities check their arguments (S005)", () => {
  const add = builtinCapabilities["network.add"].args;
  assert.doesNotThrow(() => validateArguments(add, { ssid: "Home", password: "secret-password" }));
  assert.doesNotThrow(() => validateArguments(add, { ssid: "Café", password: "" }));
  assert.throws(() => validateArguments(add, { ssid: "x".repeat(33), password: "p" }));
  assert.throws(() => validateArguments(add, { ssid: "Home", password: "p".repeat(64) }));
  assert.throws(() => validateArguments(add, { ssid: "Home" }));
  assert.throws(() => validateArguments(add, { ssid: "Home", password: "p", priority: 1 }));
  assert.doesNotThrow(() => validateArguments(builtinCapabilities["network.remove"].args, { ssid: "Home" }));
  assert.doesNotThrow(() => validateArguments(builtinCapabilities["network.list"].args, {}));
  assert.throws(() => validateArguments(builtinCapabilities["network.list"].args, { all: true }));
});
