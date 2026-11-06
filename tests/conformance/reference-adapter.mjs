// Conformance adapter around the actual reference tool dispatcher and profile store.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ControllerState } from "../../packages/sdk/controller-state.mjs";
import { executeTool } from "../../apps/controller/tools.mjs";
import { call, exchange } from "../../packages/sdk/index.mjs";
import { streamMedia } from "../../packages/sdk/media.mjs";
export function referenceAdapter() {
  const root = mkdtempSync(join(tmpdir(), "adp-reference-conformance-")),
    agents = new Map();
  const lookup = (address) => {
    const a = agents.get(address);
    if (!a) throw new Error("Unknown agent");
    return a;
  };
  const config = (a) => ({
    agent: a.address,
    devices: Object.fromEntries(
      [...a.devices.values()].map((d) => [
        d.name,
        { origin: d.endpoint, key: d.key, name: d.name },
      ]),
    ),
  });
  return {
    addAgent({ address, identity }) {
      agents.set(address, {
        address,
        identity,
        state: new ControllerState(join(root, String(agents.size))),
        devices: new Map(),
      });
    },
    async registerDevice(address, d) {
      const a = lookup(address),
        r = await call(d.endpoint, a.identity, d.key);
      if (r.assignedAgent !== address)
        throw new Error("Device belongs to another agent");
      a.state.add(d.name, d.endpoint, d.key, address);
      a.devices.set(d.key, {
        ...d,
        verified: true,
        owner: address,
        state: "online",
      });
    },
    inventory(address) {
      const a = lookup(address);
      return [...a.devices.values()].map((d) => ({
        ...d,
        active: a.state.active().key === d.key,
      }));
    },
    async refresh(address, key) {
      const a = lookup(address),
        d = a.devices.get(key);
      if (!d) throw new Error("Unknown device");
      const r = await call(d.endpoint, a.identity, key);
      if (r.assignedAgent !== address) {
        d.owner = null;
        d.verified = false;
        a.state.clearIfActive(key);
        throw new Error("Device belongs to another agent");
      }
      return r;
    },
    jump(address, key) {
      const a = lookup(address);
      if (key !== null && !a.devices.get(key)?.verified)
        throw new Error("Unknown or unverified device");
      return a.state.jump(key);
    },
    async invoke(address, key, capability, args = {}) {
      const a = lookup(address),
        d = a.devices.get(key);
      if (!d) throw new Error("Unknown device");
      const name =
        capability === "device.health"
          ? "device_health"
          : capability === "camera.snapshot"
            ? "device_snapshot"
            : null;
      if (!name) throw new Error("Unknown capability");
      if (Object.keys(args).length)
        throw new Error("Invalid capability arguments");
      const r = await executeTool(name, { device: d.name }, undefined, {
        config: () => config(a),
        self: () => a.identity,
        state: a.state,
        call,
        exchange,
        streamMedia,
      });
      return name === "device_snapshot"
        ? { mime: r.content[0].mimeType, data: r.content[0].data }
        : JSON.parse(r.content[0].text);
    },
    async stop() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
