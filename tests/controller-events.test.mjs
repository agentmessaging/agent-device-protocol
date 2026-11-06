import test from "node:test";
import assert from "node:assert/strict";
import { Controller } from "../packages/sdk/controller.mjs";
import { identity } from "../packages/sdk/index.mjs";

const agent = "lola@host.local";
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function setup(onEvent, onStateChange) {
  const key = identity().key;
  const controller = new Controller({
    onEvent,
    onStateChange,
    transport: {
      call: async () => ({
        assignedAgent: agent,
        capabilities: ["device.health"],
        streams: [],
      }),
    },
  });
  controller.addAgent({ address: agent, identity: identity() });
  await controller.registerDevice(agent, { key, endpoint: "http://127.0.0.1:23110" });
  return controller;
}

test("polling joins an in-flight notification instead of delivering it twice", async () => {
  const pending = deferred();
  const received = [];
  const c = await setup(async (event) => {
    received.push(event.id);
    await pending.promise;
  });
  const poll = c.poll();
  // Let the signed registration and event-delivery phase of poll run.
  await new Promise((resolve) => setImmediate(resolve));
  const attemptsBeforeCompletion = received.length;
  pending.resolve();
  await poll;
  assert.equal(attemptsBeforeCompletion, 1);
  assert.equal(c.snapshot().pendingEvents.length, 0);
  await c.poll();
  assert.equal(received.length, 1);
  await c.stop();
});

test("failed notifications retry with the same ID and unmodified routing data", async () => {
  const received = [];
  const c = await setup((event) => {
    received.push(structuredClone(event));
    if (received.length === 1) {
      event.agent = "other@host.local";
      event.id = "changed-by-consumer";
      event.capabilities.push("camera.snapshot");
      throw new Error("AMP temporarily unavailable");
    }
  }, (snapshot) => {
    // Application persistence/UI code must not mutate the controller queue.
    if (snapshot.pendingEvents.length) {
      snapshot.pendingEvents[0].deviceKey = "changed-by-observer";
    }
  });
  const snapshot = c.snapshot();
  assert.equal(snapshot.pendingEvents.length, 1);
  snapshot.pendingEvents[0].agent = "changed-by-snapshot";
  await c.poll();
  assert.equal(received.length, 2);
  assert.deepEqual(received[1], received[0]);
  assert.equal(received[1].agent, agent);
  assert.equal(received[1].deviceKey, c.inventory(agent)[0].key);
  assert.deepEqual(received[1].capabilities, ["device.health"]);
  assert.equal(c.snapshot().pendingEvents.length, 0);
  await c.stop();
});

test("a slow notification does not block another agent's notification", async () => {
  const pending = deferred();
  const received = [];
  const c = await setup(async (event) => {
    received.push(event.agent);
    if (event.agent === agent) await pending.promise;
  });
  const other = "other@host.local";
  c.addAgent({ address: other, identity: identity() });
  c.transport.call = async () => ({ assignedAgent: other, capabilities: [], streams: [] });
  await c.registerDevice(other, { key: identity().key, endpoint: "http://127.0.0.1:23110" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, [agent, other]);
  assert.equal(c.snapshot().pendingEvents.length, 1);
  pending.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(c.snapshot().pendingEvents.length, 0);
  await c.stop();
});

test("a synchronous callback can reenter polling without duplicating its event", async () => {
  let c;
  let calls = 0;
  let reentrantPoll;
  c = new Controller({
    onEvent: () => {
      calls++;
      reentrantPoll = c.poll();
    },
    transport: { call: async () => ({ assignedAgent: agent, capabilities: [], streams: [] }) },
  });
  c.addAgent({ address: agent, identity: identity() });
  await c.registerDevice(agent, { key: identity().key, endpoint: "http://127.0.0.1:23110" });
  await reentrantPoll;
  assert.equal(calls, 1);
  assert.equal(c.snapshot().pendingEvents.length, 0);
  await c.stop();
});
