// The ESP32 client's C core, compiled for this computer, against the SDK's signing and hub.
// Needs a C compiler, pkg-config, libsodium and cJSON; skipped without them.
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { execFileSync, spawn } from "node:child_process";
import { createPrivateKey } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import WebSocket from "ws";
import { identity, call, exchange, seal, open } from "../packages/sdk/index.mjs";
import { ReverseHub } from "../packages/sdk/reverse.mjs";
import { validateSchema } from "../packages/sdk/capabilities.mjs";

const src = new URL("../clients/embedded/esp32/", import.meta.url).pathname;
let bin, skip;
try {
  bin = join(mkdtempSync(join(tmpdir(), "adp-esp32-")), "adp_host");
  const flags = execFileSync("pkg-config", ["--cflags", "--libs", "libsodium", "libcjson"], { encoding: "utf8" });
  execFileSync("cc", ["-Wall", "-Werror", "-O1", "-o", bin, src + "main/adp.c", src + "host/adp_host.c", ...flags.trim().split(/\s+/)]);
} catch (error) {
  skip = "C toolchain, libsodium or cJSON unavailable: " + error.message.split("\n")[0];
}

// RFC 8032 section 7.1, test 1
const SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const PUBLIC = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const AGENT = "assistant@acme.aimaestro.local";
const run = (args, input) => execFileSync(bin, args, { input, encoding: "utf8" }).trim();

test("the C core signs byte for byte like the SDK", { skip }, () => {
  const key = run(["key", SEED]);
  assert.equal(key, Buffer.from(PUBLIC, "hex").toString("base64url"));
  const secret = createPrivateKey({
    key: { kty: "OKP", crv: "Ed25519", d: Buffer.from(SEED, "hex").toString("base64url"), x: key },
    format: "jwk",
  });
  const body = { type: "result", id: "a".repeat(48), challenge: "b".repeat(48), to: key, ok: true, value: { text: "Hola, Acme ✓" } };
  const packet = JSON.parse(run(["seal", SEED], JSON.stringify(body)));
  assert.deepEqual(packet, seal(body, secret));
  assert.deepEqual(open(packet, key), body);
});

async function connect(t, { agent = AGENT, pinned = AGENT, display = true } = {}) {
  const owner = identity();
  const deviceKey = run(["key", SEED]);
  const hub = new ReverseHub({ identity: owner, getDevices: () => ({ [deviceKey]: { agent: pinned } }) });
  hub.server.listen(0, "127.0.0.1");
  await once(hub.server, "listening");
  const origin = "http://127.0.0.1:" + hub.server.address().port;
  const child = spawn(bin, ["bridge", SEED, owner.key, agent, ...(display ? ["display"] : [])]);
  const shown = [];
  createInterface({ input: child.stderr }).on("line", (l) => shown.push(l));
  // Stands in for the ESP32's Wi-Fi and WebSocket: one frame per line each way
  const ws = new WebSocket(origin.replace("http:", "ws:") + "/v1/connect/" + deviceKey);
  ws.on("message", (data) => child.stdin.write(data.toString() + "\n"));
  createInterface({ input: child.stdout }).on("line", (l) => ws.readyState === WebSocket.OPEN && ws.send(l));
  ws.on("error", () => {});
  child.on("exit", () => ws.terminate());
  t.after(async () => {
    child.kill();
    ws.terminate();
    await hub.close();
  });
  return { owner, deviceKey, hub, ws, shown, endpoint: { reverse: origin }, origin };
}

test("the C core connects to the SDK hub and answers discovery, health and text", { skip }, async (t) => {
  const s = await connect(t);
  await once(s.hub, "connected");
  const reg = await call(s.endpoint, s.owner, s.deviceKey);
  assert.equal(reg.version, 1);
  assert.equal(reg.assignedAgent, AGENT);
  assert.deepEqual(reg.capabilities, ["device.health", "display.text"]);
  assert.deepEqual(reg.streams, []);
  for (const d of Object.values(reg.capabilityDefinitions)) validateSchema(d.args);

  const health = await call(s.endpoint, s.owner, s.deviceKey, "device.health");
  assert.deepEqual(health.value, { status: "ok", platform: "host" });

  const invoke = (capability, args) =>
    exchange(s.endpoint, s.owner, s.deviceKey, { type: "invoke", capability, ...(args ? { args } : {}) }, "result");
  assert.deepEqual((await invoke("display.text", { text: "Welcome to Acme" })).value, { shown: true });
  assert.deepEqual(s.shown, ["SHOW Welcome to Acme"]);
  assert.equal((await invoke("display.text", { text: "x".repeat(4097) })).error, "invalid_arguments");
  assert.equal((await invoke("device.health", { extra: 1 })).error, "invalid_arguments");
  assert.equal((await invoke("camera.snapshot")).error, "denied");
});

test("the C core offers no display unless the board has one", { skip }, async (t) => {
  const s = await connect(t, { display: false });
  await once(s.hub, "connected");
  assert.deepEqual((await call(s.endpoint, s.owner, s.deviceKey)).capabilities, ["device.health"]);
  const r = await exchange(s.endpoint, s.owner, s.deviceKey, { type: "invoke", capability: "display.text", args: { text: "hi" } }, "result");
  assert.equal(r.error, "denied");
});

test("the C core refuses a reused challenge and requests signed by another key", { skip }, async (t) => {
  // Drives the core directly, as a controller would, without the hub's own checks in front
  const owner = identity(), deviceKey = run(["key", SEED]);
  const child = spawn(bin, ["bridge", SEED, owner.key, AGENT]);
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const ask = async (frame) => {
    child.stdin.write(JSON.stringify(frame) + "\n");
    return JSON.parse((await lines.next()).value);
  };
  const proof = open(await ask({ type: "hello", challenge: "d".repeat(48) }), deviceKey);
  assert.equal(proof.type, "connect");
  child.stdin.write(JSON.stringify(seal({ type: "connected", id: proof.id, challenge: proof.challenge, to: deviceKey, deviceChallenge: proof.deviceChallenge }, owner.secret)) + "\n");
  const { challenge } = (await ask({ type: "rpc", id: "1".repeat(48), method: "challenge" })).body;
  const request = (signer) =>
    ask({ type: "rpc", id: "2".repeat(48), method: "request", body: seal({ type: "discover", id: "c".repeat(48), challenge, to: deviceKey }, signer.secret) });
  assert.equal((await request(identity())).status, 403);
  const answer = await request(owner);
  assert.equal(answer.status, 200);
  assert.equal(open(answer.body, deviceKey).type, "register");
  assert.equal((await request(owner)).status, 403);
});

test("the hub refuses the C core when it names another agent", { skip }, async (t) => {
  const s = await connect(t, { agent: "other@acme.aimaestro.local" });
  const [code, reason] = await once(s.ws, "close");
  assert.equal(code, 4003);
  assert.equal(reason.toString(), "not_owner");
});
