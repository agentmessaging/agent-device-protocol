// The ESP32 client's C core, compiled for this computer, against the SDK's signing and hub.
// Needs a C compiler, pkg-config, libsodium and cJSON; skipped without them.
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { execFileSync, spawn } from "node:child_process";
import { createPrivateKey, sign } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import WebSocket from "ws";
import { identity, call, exchange, seal, open } from "../packages/sdk/index.mjs";
import { ReverseHub } from "../packages/sdk/reverse.mjs";
import { secureHello, secureFinish } from "../packages/sdk/secure.mjs";
import { validateSchema, builtinCapabilities } from "../packages/sdk/capabilities.mjs";

const src = new URL("../clients/embedded/esp32/", import.meta.url).pathname;
let bin, skip;
try {
  bin = join(mkdtempSync(join(tmpdir(), "adp-esp32-")), "adp_host");
  const flags = execFileSync("pkg-config", ["--cflags", "--libs", "libsodium", "libcjson"], { encoding: "utf8" });
  // The firmware sets the same larger frame limit when the speaker is on (speaker.play needs about 1 MiB)
  execFileSync("cc", ["-Wall", "-Werror", "-O1", "-DADP_MAX_FRAME=1100000", "-o", bin, src + "main/adp.c", src + "host/adp_host.c", ...flags.trim().split(/\s+/)]);
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

async function connect(t, { agent = AGENT, pinned = AGENT, display = true, camera = false, secure = false, isHome, speaker = false, microphone = false, onAudio } = {}) {
  const owner = identity();
  const deviceKey = run(["key", SEED]);
  const hub = new ReverseHub({ identity: owner, getDevices: () => ({ [deviceKey]: { agent: pinned } }), ...(isHome ? { isHome } : {}), ...(onAudio ? { onAudio } : {}) });
  hub.server.listen(0, "127.0.0.1");
  await once(hub.server, "listening");
  const origin = "http://127.0.0.1:" + hub.server.address().port;
  const child = spawn(bin, ["bridge", SEED, owner.key, agent, ...(display ? ["display"] : []), ...(camera ? ["camera"] : []), ...(secure ? ["secure"] : []), ...(speaker ? ["speaker"] : []), ...(microphone ? ["microphone"] : [])]);
  const shown = [], refused = [];
  createInterface({ input: child.stderr }).on("line", (l) => shown.push(l));
  // Stands in for the ESP32's Wi-Fi and WebSocket: one frame per line each way ("T text" or "B hex" when secure)
  const ws = new WebSocket(origin.replace("http:", "ws:") + (secure ? "/v1/secure/" : "/v1/connect/") + deviceKey);
  ws.on("message", (data, isBinary) =>
    child.stdin.write((secure ? (isBinary ? "B " + data.toString("hex") : "T " + data.toString()) : data.toString()) + "\n"),
  );
  const forward = (l) => (!secure ? l : l.startsWith("B ") ? Buffer.from(l.slice(2), "hex") : l.slice(2));
  createInterface({ input: child.stdout }).on("line", (l) =>
    l === "NOAUDIO" ? refused.push(l) : ws.readyState === WebSocket.OPEN && ws.send(forward(l)),
  );
  ws.on("error", () => {});
  child.on("exit", () => ws.terminate());
  t.after(async () => {
    child.kill();
    ws.terminate();
    await hub.close();
  });
  const talk = (bytes) => child.stdin.write("A " + bytes + "\n");
  return { owner, deviceKey, hub, ws, shown, refused, talk, endpoint: { reverse: origin }, origin };
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

test("the C core refuses signed bodies a JS verifier would read differently, and replayed acks", { skip }, async (t) => {
  const owner = identity(), deviceKey = run(["key", SEED]);
  const child = spawn(bin, ["bridge", SEED, owner.key, AGENT, "display"]);
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const send = (frame) => child.stdin.write(JSON.stringify(frame) + "\n");
  const ask = async (frame) => {
    send(frame);
    return JSON.parse((await lines.next()).value);
  };
  // The owner's signature over exact bytes, as seal() would, but over text seal() never makes
  const raw = (text) => {
    const bytes = Buffer.from(text);
    const signature = sign(null, Buffer.concat([Buffer.from("ai-maestro-device/1\0"), bytes]), createPrivateKey(owner.secret));
    return { body: bytes.toString("base64url"), signature: signature.toString("base64url") };
  };
  const proof = open(await ask({ type: "hello", challenge: "d".repeat(48) }), deviceKey);
  const connected = seal({ type: "connected", id: proof.id, challenge: proof.challenge, to: deviceKey, deviceChallenge: proof.deviceChallenge }, owner.secret);
  send(connected);
  const challenge = async () => (await ask({ type: "rpc", id: "1".repeat(48), method: "challenge" })).body.challenge;
  const request = async (text) => ask({ type: "rpc", id: "2".repeat(48), method: "request", body: raw(text) });
  let c = await challenge();
  assert.equal((await request(JSON.stringify({ type: "discover", id: "c".repeat(48), challenge: c, to: deviceKey }) + "GARBAGE")).status, 403);
  c = await challenge();
  assert.equal((await request(JSON.stringify({ type: "discover", id: "c".repeat(48), challenge: c, to: deviceKey }) + "\n")).status, 200);
  c = await challenge();
  const twice = `{"type":"invoke","id":"${"c".repeat(48)}","challenge":"${c}","to":"${deviceKey}","capability":"display.text","args":{"text":"A"},"capability":"device.health"}`;
  assert.equal((await request(twice)).status, 403);
  // A replayed connected is not an event.ack: the device ends the connection
  send(connected);
  const [code] = await once(child, "exit");
  assert.notEqual(code, 0);
});

// S003: the encrypted home network connection in the C core

test("the C core gives the published S003 test vectors", { skip }, () => {
  const v = JSON.parse(readFileSync(new URL("./vectors/secure-v1.json", import.meta.url)));
  assert.equal(run(["x25519", v.controllerEphemeralSecret]), v.controllerEphemeral);
  assert.equal(run(["x25519", v.deviceEphemeralSecret]), v.deviceEphemeral);
  const hex = (text) => Buffer.from(text).toString("hex");
  assert.equal(run(["secure-keys", v.shared, hex(v.helloBody), hex(v.acceptBody)]), v.controllerToDevice + " " + v.deviceToController);
  assert.equal(run(["secure-seal", v.controllerToDevice], v.firstPlaintext), v.firstCiphertext);
});

test("the C core connects to the SDK hub through /v1/secure from a home network address", { skip }, async (t) => {
  const s = await connect(t, { secure: true, isHome: () => true });
  await once(s.hub, "connected");
  assert.ok(s.hub.connections.get(s.deviceKey).adpChannel, "the hub side is encrypted");
  const reg = await call(s.endpoint, s.owner, s.deviceKey);
  assert.equal(reg.assignedAgent, AGENT);
  assert.deepEqual((await call(s.endpoint, s.owner, s.deviceKey, "device.health")).value, { status: "ok", platform: "host" });
  const r = await exchange(s.endpoint, s.owner, s.deviceKey, { type: "invoke", capability: "display.text", args: { text: "Hola desde casa" } }, "result");
  assert.deepEqual(r.value, { shown: true });
  assert.deepEqual(s.shown, ["SHOW Hola desde casa"]);
});

test("the C core sends a camera snapshot through /v1/secure from a home network address", { skip }, async (t) => {
  const s = await connect(t, { secure: true, camera: true, isHome: () => true });
  await once(s.hub, "connected");
  const reg = await call(s.endpoint, s.owner, s.deviceKey);
  assert.ok(reg.capabilities.includes("camera.snapshot"));
  assert.equal(reg.capabilityDefinitions["camera.snapshot"].activation, "active");
  assert.equal(reg.permissions.camera, true);
  const r = await call(s.endpoint, s.owner, s.deviceKey, "camera.snapshot");
  assert.equal(r.ok, true);
  assert.equal(r.value.mime, "image/jpeg");
  const jpeg = Buffer.from(r.value.data, "base64");
  assert.equal(jpeg.length, 300 * 1024);
  assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  const bad = await exchange(s.endpoint, s.owner, s.deviceKey, { type: "invoke", capability: "camera.snapshot", args: { quality: 1 } }, "result");
  assert.equal(bad.error, "invalid_arguments");
});

test("the C core offers no camera without the owner's grant", { skip }, async (t) => {
  const s = await connect(t, { secure: true, isHome: () => true });
  await once(s.hub, "connected");
  const reg = await call(s.endpoint, s.owner, s.deviceKey);
  assert.ok(!reg.capabilities.includes("camera.snapshot"));
  const r = await exchange(s.endpoint, s.owner, s.deviceKey, { type: "invoke", capability: "camera.snapshot" }, "result");
  assert.equal(r.error, "denied");
});

const wav = (n, magic = "RIFF") => {
  const b = Buffer.alloc(n, 7);
  b.write(magic, 0, "latin1");
  b.write("WAVE", 8, "latin1");
  return b.toString("base64");
};

test("the C core plays speaker.play through /v1/secure and checks the WAV", { skip }, async (t) => {
  const s = await connect(t, { secure: true, speaker: true, isHome: () => true });
  await once(s.hub, "connected");
  const reg = await call(s.endpoint, s.owner, s.deviceKey);
  assert.ok(reg.capabilities.includes("speaker.play"));
  assert.deepEqual(reg.capabilityDefinitions["speaker.play"], builtinCapabilities["speaker.play"]);
  assert.equal(reg.permissions["speaker.play"], true);
  const play = (args) => exchange(s.endpoint, s.owner, s.deviceKey, { type: "invoke", capability: "speaker.play", args }, "result");
  assert.deepEqual((await play({ mime: "audio/wav", data: wav(300 * 1024) })).value, { played: true });
  assert.deepEqual(s.shown, ["PLAY " + 300 * 1024]);
  assert.equal((await play({ mime: "audio/wav", data: wav(1000, "RIFX") })).error, "invalid_arguments");
  assert.equal((await play({ mime: "audio/wav", data: wav(384 * 1024 + 3) })).error, "invalid_arguments");
  assert.equal((await play({ mime: "audio/mpeg", data: wav(1000) })).error, "invalid_arguments");
  assert.equal((await play({ mime: "audio/wav", data: wav(1000), volume: 1 })).error, "invalid_arguments");
  assert.equal((await play({ mime: "audio/wav", data: wav(1000) + "\n" })).error, "invalid_arguments");
  assert.equal(s.shown.length, 1);
});

test("the C core sends what a person said as a signed audio event", { skip }, async (t) => {
  const heard = [];
  let arrived;
  const s = await connect(t, { secure: true, microphone: true, isHome: () => true, onAudio: (key, audio) => { heard.push([key, audio]); arrived?.(); } });
  await once(s.hub, "connected");
  assert.equal((await call(s.endpoint, s.owner, s.deviceKey)).permissions.microphone, true);
  const next = () => new Promise((r) => (arrived = r));
  let wait = next();
  s.talk(64044);
  await wait;
  assert.equal(heard[0][0], s.deviceKey);
  assert.equal(heard[0][1].length, 64044);
  assert.equal(heard[0][1].toString("latin1", 0, 4), "RIFF");
  // After the acknowledgement the hub issues a fresh challenge, so the person can talk again
  await new Promise((r) => setTimeout(r, 100));
  wait = next();
  s.talk(640 * 1024);
  await wait;
  assert.equal(heard[1][1].length, 640 * 1024);
  await new Promise((r) => setTimeout(r, 100));
  s.talk(640 * 1024 + 1);
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(s.refused, ["NOAUDIO"]);
  assert.equal(heard.length, 2);
});

test("the C core sends no audio without the microphone grant or over a plain connection", { skip }, async (t) => {
  const a = await connect(t, { secure: true, isHome: () => true });
  await once(a.hub, "connected");
  assert.equal((await call(a.endpoint, a.owner, a.deviceKey)).permissions.microphone, undefined);
  a.talk(1000);
  const b = await connect(t, { microphone: true });
  await once(b.hub, "connected");
  b.talk(1000);
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(a.refused, ["NOAUDIO"]);
  assert.deepEqual(b.refused, ["NOAUDIO"]);
});

test("the hub refuses the C core on /v1/secure when it names another agent", { skip }, async (t) => {
  const s = await connect(t, { secure: true, agent: "other@acme.aimaestro.local" });
  const [code, reason] = await once(s.ws, "close");
  assert.equal(code, 4003);
  assert.equal(reason.toString(), "not_owner");
});

/** Drives the core's secure mode directly, as a controller would */
function secureDevice(t, owner = identity()) {
  const child = spawn(bin, ["bridge", SEED, owner.key, AGENT, "secure"]);
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const exited = once(child, "exit");
  return { child, owner, deviceKey: run(["key", SEED]), next: async () => (await lines.next()).value, send: (l) => child.stdin.write(l + "\n"), exited };
}

async function established(t) {
  const d = secureDevice(t);
  const { packet, state } = secureHello(d.owner.secret, d.deviceKey);
  d.send("T " + JSON.stringify(packet));
  const accept = await d.next();
  assert.ok(accept.startsWith("T "), "the accept is a text message");
  const channel = secureFinish(state, JSON.parse(accept.slice(2)), { deviceKey: d.deviceKey, controllerKey: d.owner.key, assignedAgent: AGENT });
  const sealed = (frame) => "B " + channel.seal(JSON.stringify(frame)).toString("hex");
  return { ...d, channel, sealed };
}

test("the C core answers the profile inside the encrypted connection", { skip }, async (t) => {
  const d = await established(t);
  d.send(d.sealed({ type: "hello", challenge: "d".repeat(48) }));
  const reply = await d.next();
  assert.ok(reply.startsWith("B "), "answers are binary");
  const proof = open(JSON.parse(d.channel.open(Buffer.from(reply.slice(2), "hex"), true)), d.deviceKey);
  assert.equal(proof.type, "connect");
  assert.equal(proof.assignedAgent, AGENT);
});

test("the C core refuses a hello signed by another key, a hello for another device, and a binary hello", { skip }, async (t) => {
  for (const make of [
    (d) => "T " + JSON.stringify(secureHello(identity().secret, d.deviceKey).packet),
    (d) => "T " + JSON.stringify(secureHello(d.owner.secret, identity().key).packet),
    (d) => "B " + Buffer.from(JSON.stringify(secureHello(d.owner.secret, d.deviceKey).packet)).toString("hex"),
    (d) => "T " + JSON.stringify({ type: "hello", challenge: "d".repeat(48) }),
  ]) {
    const d = secureDevice(t);
    d.send(make(d));
    const [code] = await d.exited;
    assert.notEqual(code, 0);
  }
});

test("the C core closes on a changed, replayed or plain message after the key exchange", { skip }, async (t) => {
  for (const attack of ["change", "replay", "plain", "skip"]) {
    const d = await established(t);
    const good = d.sealed({ type: "hello", challenge: "d".repeat(48) });
    if (attack === "change") d.send(good.slice(0, -1) + (good.endsWith("0") ? "1" : "0"));
    else if (attack === "replay") {
      d.send(good);
      await d.next();
      d.send(good);
    } else if (attack === "plain") d.send("T " + JSON.stringify({ type: "hello", challenge: "d".repeat(48) }));
    else {
      d.channel.seal("{}"); // a message the device never sees: the counters no longer match
      d.send(d.sealed({ type: "hello", challenge: "d".repeat(48) }));
    }
    const [code] = await d.exited;
    assert.notEqual(code, 0, attack);
  }
});
