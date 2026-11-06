import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("CLI identifies keys and confirms pairing while preserving bare-key stdout", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "adp-setup-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, ADP_HOME: dir };
  const run = (file, ...args) =>
    spawnSync(process.execPath, [file, ...args], { env, encoding: "utf8" });
  const init = run("apps/controller/cli.mjs", "init");
  assert.equal(init.status, 0);
  assert.match(init.stderr, /Agent public key/);
  assert.match(init.stderr, /Fingerprint: [a-f0-9]{16}/);
  assert.ok(init.stderr.includes(dir));
  const key = init.stdout.trim();
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(run("apps/controller/cli.mjs", "init").stdout.trim(), key);
  const paired = run("apps/controller/cli.mjs", "pair", key);
  assert.equal(paired.status, 0);
  assert.match(paired.stderr, /Saved device pairing/);
  assert.ok(paired.stderr.includes(key));
  assert.equal(JSON.parse(readFileSync(join(dir, "peer.json"))).key, key);
  const device = run("clients/linux/cli.mjs", "init");
  assert.match(device.stderr, /Device public key/);
  assert.equal(device.stdout.trim(), key);
});
test("service keeps a legacy fallback and permits an explicitly selected runtime", () => {
  const unit = readFileSync("clients/linux/ai-maestro-device.service", "utf8");
  assert.match(unit, /Environment=ADP_NODE=\/usr\/bin\/node/);
  assert.match(unit, /ExecStart=\/usr\/bin\/env \$\{ADP_NODE\}/);
  // env executes an absolute interpreter without requiring a shell profile.
  const version = execFileSync(
    "/usr/bin/env",
    [process.execPath, "--version"],
    { encoding: "utf8" },
  );
  assert.equal(version.trim(), process.version);
});
