import { Controller } from "../packages/sdk/controller.mjs";
import { controllerConformance } from "./conformance/controller-contract.mjs";
controllerConformance((options) => new Controller(options));

import test from "node:test";
import assert from "node:assert/strict";
import { identity, nonce } from "../packages/sdk/index.mjs";
test("late discovery cannot restore ownership after a confirmed revoke", async () => {
  const owner = identity(),
    key = identity().key,
    agent = "lola@host.local";
  const registration = {
    assignedAgent: agent,
    capabilities: ["device.health"],
    streams: [],
  };
  let resolveDiscovery;
  const transport = {
    call: async () => registration,
    exchange: async (_endpoint, _self, _key, command) => ({
      type: "proposal.ack",
      requestId: command.requestId,
      status: "confirmed",
    }),
  };
  const c = new Controller({ transport });
  c.addAgent({ address: agent, identity: owner });
  await c.registerDevice(agent, { key, endpoint: "http://127.0.0.1:23110" });
  c.jump(agent, key);
  transport.call = () =>
    new Promise((resolve) => {
      resolveDiscovery = resolve;
    });
  const stale = c.refresh(agent, key),
    rejected = assert.rejects(stale, /superseded/);
  await c.propose(agent, key, { action: "revoke" }, { requestId: nonce() });
  resolveDiscovery(registration);
  await rejected;
  assert.equal(c.inventory(agent)[0].verified, false);
  assert.equal(c.inventory(agent)[0].active, false);
  c.pinDevice(agent, { key, endpoint: "http://127.0.0.1:23110" });
  assert.equal(c.inventory(agent)[0].state, "unverified");
  await c.stop();
});
