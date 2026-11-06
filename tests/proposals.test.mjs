import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Proposals } from "../clients/linux/proposals.mjs";
import { bridge } from "../clients/linux/server.mjs";
import { identity, nonce, call, exchange } from "@ai-maestro/device-sdk";

test("local approval is required and signed completion survives transfer", async (t) => {
  const first = identity(),
    next = identity(),
    device = identity();
  let policy = { key: first.key, assignedAgent: "first@host.local" };
  let storage = null;
  const pending = new Proposals(
    () => {
      if (!policy) throw Error();
      return policy;
    },
    () => storage,
    (v) => {
      storage = v;
    },
    (change) => {
      policy =
        change.action === "revoke"
          ? null
          : { key: change.key, assignedAgent: change.agent };
    },
  );
  const server = bridge(
    device,
    () => {
      if (!policy) throw Error();
      return policy;
    },
    undefined,
    undefined,
    undefined,
    pending,
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      }),
  );
  const origin = "http://127.0.0.1:" + server.address().port;
  const command = {
    type: "proposal",
    requestId: nonce(),
    change: { action: "transfer", agent: "next@host.local", key: next.key },
  };
  const send = () =>
    exchange(origin, first, device.key, command, "proposal.ack", fetch);
  assert.equal((await send()).status, "awaiting_local_approval");
  assert.equal(
    (await call(origin, first, device.key)).assignedAgent,
    "first@host.local",
  );
  pending.decide(command.requestId, true);
  assert.equal((await send()).status, "confirmed");
  assert.equal((await send()).status, "confirmed");
  await assert.rejects(call(origin, first, device.key, "device.health"), /403/);
  assert.equal(
    (await call(origin, next, device.key)).assignedAgent,
    "next@host.local",
  );
});
test("rejected or superseded requests never reappear on retry", () => {
  const first = identity();
  let policy = {
      key: first.key,
      assignedAgent: "first@host.local",
      revision: "1",
    },
    storage = null;
  const pending = new Proposals(
    () => policy,
    () => storage,
    (v) => {
      storage = v;
    },
    () => assert.fail("unexpected apply"),
  );
  const id = nonce(),
    change = { action: "camera", enabled: true };
  pending.request(id, change);
  pending.decide(id, false);
  assert.equal(pending.request(id, change).status, "rejected");
  pending.request(nonce(), change);
  policy = { ...policy, revision: "2" };
  assert.equal(pending.pending(), null);
});

test("stale expected revisions return conflicts and cannot queue a local approval", () => {
  let peer = {
      key: identity().key,
      assignedAgent: "lola@host.local",
      revision: "new",
    },
    storage;
  const p = new Proposals(
    () => peer,
    () => storage,
    (value) => {
      storage = value;
    },
    () => {
      peer = { ...peer, revision: "next" };
    },
  );
  assert.equal(
    p.request(nonce(), { action: "camera", enabled: true }, "old").status,
    "revision_mismatch",
  );
  assert.equal(p.pending(), null);
  const id = nonce();
  assert.equal(
    p.request(id, { action: "camera", enabled: true }, "new").status,
    "awaiting_local_approval",
  );
  p.decide(id, true);
  assert.equal(p.receipt().revision, "next");
  assert.equal(
    p.request(nonce(), { action: "revoke" }, "new").status,
    "revision_mismatch",
  );
});
