import { init, pair, self, peer } from "../../packages/sdk/state.mjs";
import { localAddress } from "@ai-maestro/device-sdk";
import { bridge } from "./server.mjs";
const [action, arg, option, ...extra] = process.argv.slice(2);
if (action === "init" && !arg) init();
else if (
  action === "pair" &&
  (!option || option === "--camera") &&
  !extra.length
)
  pair(arg, option === "--camera");
else if (action === "serve" && !option) {
  const host = arg || "127.0.0.1";
  if (!localAddress(host))
    throw new Error("Bind to a loopback or a local Tailscale IPv4 address");
  peer();
  bridge(self(), peer).listen(23110, host, () =>
    console.log("Device listening on http://" + host + ":23110"),
  );
} else
  throw new Error(
    "Usage: init | pair CONTROLLER_KEY [--camera] | serve [TAILSCALE_IP]",
  );
