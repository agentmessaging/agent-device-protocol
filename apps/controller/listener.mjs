import { ReverseHub } from "../../packages/sdk/reverse.mjs";
import { privateOrigin, call } from "@ai-maestro/device-sdk";
import { self } from "../../packages/sdk/state.mjs";
import { state, config } from "./registry.mjs";
import { nonce } from "@ai-maestro/device-sdk";
import { monitor } from "./monitor.mjs";
export async function listen(origin) {
  const url = new URL(privateOrigin(origin));
  const hub = new ReverseHub({
    identity: self(),
    getDevices: () =>
      Object.fromEntries(
        Object.values(config().devices).map((d) => [
          d.key,
          { agent: config().agent },
        ]),
      ),
    onUsed: async (key) => {
      const c = config();
      const d = Object.values(c.devices).find((d) => d.key === key);
      if (!d) throw new Error("Unknown device");
      const r = await call(d.origin, self(), key);
      if (r.assignedAgent !== c.agent) throw new Error("Owner changed");
      state.jump(key);
    },
    onProposal: async (key, event) => {
      const receipts = state.read("proposal-results.json", {});
      receipts[event.requestId] = { ...event, deviceKey: key };
      state.write("proposal-results.json", receipts);
    },
    onInput: async (key, text) => {
      const c = config(),
        d = Object.values(c.devices).find((d) => d.key === key);
      if (!d) throw new Error("Unknown device");
      const r = await call(d.origin, self(), key);
      if (r.assignedAgent !== c.agent) throw new Error("Owner changed");
      state.jump(key);
      const queue = state.read("input-events.json", []);
      if (queue.length >= 100) throw new Error("Input queue full");
      queue.push({
        id: nonce(),
        agent: c.agent,
        deviceKey: key,
        text,
        source: "device",
      });
      state.write("input-events.json", queue);
    },
  });
  hub.server.listen(Number(url.port) || 80, url.hostname);
  await new Promise((resolve, reject) => {
    hub.server.once("listening", resolve);
    hub.server.once("error", reject);
  });
  console.log("Controller connections: " + url.origin);
  try {
    await monitor();
  } finally {
    await hub.close();
  }
}
