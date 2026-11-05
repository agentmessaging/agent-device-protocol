import { init, pair, self, peer } from "../../packages/sdk/state.mjs";
import { agentAddress, localAddress } from "@ai-maestro/device-sdk";
import { DisplayState, displayServer } from "../../apps/display/server.mjs";
import { bridge } from "./server.mjs";
const [action, arg, option, ...extra] = process.argv.slice(2);
if (action === "init" && !arg) init();
else if (
  action === "assign" &&
  (extra.length === 0 || (extra.length === 1 && extra[0] === "--camera"))
) {
  pair(option, {
    assignedAgent: agentAddress(arg),
    camera: extra.length === 1,
  });
} else if (action === "assignment" && !arg) {
  const policy = peer();
  console.log(
    JSON.stringify(
      { ...policy, assignedAgent: agentAddress(policy.assignedAgent) },
      null,
      2,
    ),
  );
} else if (action === "serve" && !option) {
  const host = arg || "127.0.0.1";
  if (!localAddress(host))
    throw new Error("Bind to a loopback or a local Tailscale IPv4 address");
  agentAddress(peer().assignedAgent);
  const display = new DisplayState(peer);
  displayServer(display).listen(23111, "127.0.0.1", () =>
    console.log("Display: http://127.0.0.1:23111"),
  );
  bridge(self(), peer, undefined, display).listen(23110, host, () =>
    console.log("Device listening on http://" + host + ":23110"),
  );
} else
  throw new Error(
    "Usage: init | assignment | assign AMP_ADDRESS AGENT_PUBLIC_KEY [--camera] | serve [TAILSCALE_IP]",
  );
