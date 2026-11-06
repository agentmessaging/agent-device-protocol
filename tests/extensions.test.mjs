import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identity, call, exchange } from "../packages/sdk/index.mjs";
import { bridge } from "../clients/linux/server.mjs";
import { DisplayState } from "../apps/display/server.mjs";
import { CustomCapabilities, loadCustom } from "../clients/linux/custom.mjs";

async function start(t, server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  return "http://127.0.0.1:" + server.address().port;
}
test("a bridge without a local indicator does not advertise or capture camera", async (t) => {
  const owner = identity(),
    device = identity();
  let captures = 0;
  const origin = await start(
    t,
    bridge(
      device,
      () => ({
        key: owner.key,
        assignedAgent: "lola@host.local",
        camera: true,
      }),
      {
        cameraReady: () => true,
        snapshot: async () => {
          captures++;
        },
      },
    ),
  );
  assert.deepEqual((await call(origin, owner, device.key)).capabilities, [
    "device.health",
  ]);
  assert.equal(
    (await call(origin, owner, device.key, "camera.snapshot")).ok,
    false,
  );
  assert.equal(captures, 0);
});
test("capture waits for a visible sign and preserves it for at least three seconds", async () => {
  let now = 1000;
  const d = new DisplayState(
    () => ({ key: "key", assignedAgent: "lola@host.local", camera: true }),
    () => now,
  );
  d.ackPresence(true, d.indicatorId);
  const indicated = d.indicate("camera");
  assert.deepEqual(d.read().indicators, ["camera"]);
  d.ackPresence(true, d.indicatorId);
  await indicated;
  now += 2999;
  assert.deepEqual(d.read().indicators, ["camera"]);
  now++;
  assert.deepEqual(d.read().indicators, []);
  assert.equal(d.indicatorReady(), false);
  await assert.rejects(d.indicate("camera"), /unavailable/);
});
test("locally granted typed output rejects markup paths and clears on transfer", async (t) => {
  const owner = identity(),
    device = identity();
  let peer = {
    key: owner.key,
    assignedAgent: "lola@host.local",
    revision: "one",
    outputs: { "display.text": true, "display.image": true },
  };
  const display = new DisplayState(() => peer),
    origin = await start(
      t,
      bridge(device, () => peer, undefined, display),
    );
  const invoke = (capability, args) =>
    exchange(
      origin,
      owner,
      device.key,
      { type: "invoke", capability, args },
      "result",
    );
  assert.equal(
    (await invoke("display.text", { text: "<script>literal text</script>" }))
      .ok,
    true,
  );
  assert.equal(display.read().output.text, "<script>literal text</script>");
  assert.equal(
    (await invoke("display.text", { text: "a".repeat(4097) })).error,
    "invalid_arguments",
  );
  assert.equal(
    (await invoke("display.text", { text: "hello", url: "file:///etc/passwd" }))
      .error,
    "invalid_arguments",
  );
  assert.equal(
    (await invoke("display.image", { mime: "image/svg+xml", data: "abc" }))
      .error,
    "invalid_arguments",
  );
  assert.equal(
    (await invoke("display.image", { mime: "image/jpeg", data: "/9j/2Q==" }))
      .ok,
    true,
  );
  peer = {
    key: identity().key,
    assignedAgent: "other@host.local",
    revision: "two",
  };
  assert.equal(display.read().output, null);
});
test("owner-installed custom capabilities are bounded, typed, locally granted and not remotely editable", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "adp-custom-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, "sensor.mjs"),
    "export async function handle(args){return {temperature:args.offset+20}}",
    { mode: 0o600 },
  );
  const definition = {
    name: "custom.greenhouse.temperature",
    description: "Read temperature",
    sensor: true,
    activation: "active",
    args: {
      type: "object",
      properties: { offset: { type: "integer", minimum: -5, maximum: 5 } },
      required: ["offset"],
      additionalProperties: false,
    },
    timeoutMs: 1000,
    module: "sensor.mjs",
  };
  const file = join(dir, "sensor.json");
  writeFileSync(file, JSON.stringify(definition), { mode: 0o600 });
  const c = new CustomCapabilities(dir),
    peer = { custom: { [definition.name]: true } };
  assert.deepEqual(await c.invoke(definition.name, { offset: 2 }, peer), {
    temperature: 22,
  });
  assert.deepEqual(c.definitions({}), {});
  await assert.rejects(
    c.invoke(definition.name, { offset: 2, path: "/tmp/a" }, peer),
    /arguments/,
  );
  await assert.rejects(
    c.invoke(definition.name, { offset: "2" }, peer),
    /numeric/,
  );
  await assert.rejects(
    c.invoke("custom.owner.install", { code: "hello" }, peer),
    /denied/,
  );
  chmodSync(file, 0o666);
  assert.throws(() => loadCustom(dir), /Unsafe/);
  chmodSync(file, 0o600);
  writeFileSync(
    join(dir, "sensor.mjs"),
    "export async function handle(){await new Promise(r=>setTimeout(r,10000))}",
    { mode: 0o600 },
  );
  writeFileSync(file, JSON.stringify({ ...definition, timeoutMs: 100 }));
  await assert.rejects(
    c.invoke(definition.name, { offset: 0 }, peer),
    /timed out/,
  );
});
