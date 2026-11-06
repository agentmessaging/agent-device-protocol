import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { identity } from "../packages/sdk/index.mjs";
import { ControllerState } from "../packages/sdk/controller-state.mjs";
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "adp-profile-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, state: new ControllerState(dir) };
}
test("reference inventory migrates the legacy pin without inventing an endpoint or losing activation", (t) => {
  const { dir, state } = fixture(t),
    key = identity().key;
  writeFileSync(join(dir, "peer.json"), JSON.stringify({ key }));
  assert.equal(state.registry().devices[key].origin, null);
  assert.equal(state.active().key, key);
  state.add("macbook", "http://127.0.0.1:23110", key, "lola@host.local");
  assert.equal(state.registry().devices[key].name, "macbook");
  const next = identity().key;
  state.add("kitchen", "http://127.0.0.1:23111", next, "lola@host.local");
  const guard = state.guard(key);
  state.jump(next);
  assert.throws(() => guard.check(), /idle|changed/);
  guard.close();
  state.clearIfActive(key);
  assert.equal(state.active().key, next);
  assert.equal(Object.keys(state.registry().devices).length, 2);
});
test("concurrent profile jumps serialize and the last accepted jump wins", async (t) => {
  const { dir, state } = fixture(t),
    keys = [identity().key, identity().key];
  const module = new URL(
    "../packages/sdk/controller-state.mjs",
    import.meta.url,
  ).href;
  const jump = (key) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        "--input-type=module",
        "-e",
        `import {ControllerState} from ${JSON.stringify(module)};console.log(JSON.stringify(new ControllerState(process.argv[1]).jump(process.argv[2])))`,
        dir,
        key,
      ]);
      let out = "";
      child.stdout.on("data", (c) => (out += c));
      child.on("error", reject);
      child.on("close", (code) =>
        code ? reject(new Error("Jump failed")) : resolve(JSON.parse(out)),
      );
    });
  const results = await Promise.all(keys.map(jump));
  const last = results.sort((a, b) => b.order - a.order)[0];
  assert.deepEqual(state.active(), last);
});
