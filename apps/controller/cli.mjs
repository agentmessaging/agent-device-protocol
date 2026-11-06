import { writeFileSync } from "node:fs";
import { init, pair, self, peer } from "../../packages/sdk/state.mjs";
import { listen } from "./listener.mjs";
import { executeTool } from "./tools.mjs";
import { addDevice, config, state, jumpDevice } from "./registry.mjs";
import { installMcp } from "./install.mjs";
import { monitor } from "./monitor.mjs";
import { watch } from "./watch.mjs";
import { announce } from "./announce.mjs";
import { call } from "@ai-maestro/device-sdk";
const [action, arg, capability, out, ...extra] = process.argv.slice(2);
if (action === "init" && !arg) init("agent");
else if (action === "pair" && !capability) pair(arg);
else if (action === "install-mcp" && arg && !capability) installMcp(arg);
else if (action === "monitor" && !arg) await monitor();
else if (action === "listen" && arg && !capability) await listen(arg);
else if (action === "list" && !arg)
  console.log((await executeTool("device_list", {})).content[0].text);
else if (action === "jump" && arg && !capability)
  console.log(JSON.stringify(jumpDevice(arg)));
else if (
  action === "add-outbound" &&
  arg &&
  capability &&
  out &&
  extra.length === 1
) {
  state.add(arg, { reverse: extra[0] }, capability, out);
  console.log("Configured outbound device " + arg);
} else if (action === "add" && arg && capability && !extra.length)
  await addDevice(arg, capability, out);
else if (action === "watch" && arg && !out) await watch(arg, capability);
else if (action === "announce" && !out) await announce(arg, capability);
else if (
  (action === "discover" && !capability) ||
  (action === "invoke" && capability && !extra.length)
) {
  let name = arg;
  if (arg.startsWith("http:")) {
    const known = Object.values(config().devices).find((d) => d.origin === arg);
    if (!known) await addDevice("legacy", arg);
    name = known?.name ?? "legacy";
  }
  const device = config().devices[name];
  if (!device) throw new Error("Unknown device; add it first");
  let result;
  if (action === "discover")
    result = await call(device.origin, self(), device.key);
  else {
    const tool =
      capability === "device.health"
        ? "device_health"
        : capability === "camera.snapshot"
          ? "device_snapshot"
          : null;
    if (!tool) throw new Error("Unsupported operation");
    try {
      const response = await executeTool(tool, { device: name });
      result = {
        type: "result",
        ok: true,
        value:
          tool === "device_snapshot"
            ? { mime: "image/jpeg", data: response.content[0].data }
            : JSON.parse(response.content[0].text),
      };
    } catch (error) {
      result = { type: "result", ok: false, error: error.message };
    }
  }
  if (out && capability !== "camera.snapshot")
    throw new Error("Output file is only valid for camera.snapshot");
  if (result.ok && result.value.mime === "image/jpeg" && out) {
    writeFileSync(out, Buffer.from(result.value.data, "base64"), {
      flag: "wx",
      mode: 0o600,
    });
    console.log(out);
  } else console.log(JSON.stringify(result, null, 2));
  if (result.ok === false) process.exitCode = 1;
} else
  throw new Error(
    "Usage: init | list | jump NAME|none | listen CONTROLLER_ORIGIN | add-outbound NAME DEVICE_KEY AMP_ADDRESS CONTROLLER_ORIGIN | pair DEVICE_KEY | install-mcp WORKSPACE | monitor | add DEVICE_NAME URL | discover URL | watch URL [ASSIGNED_AMP_ADDRESS] | announce URL [ASSIGNED_AMP_ADDRESS] | invoke URL CAPABILITY [NEW_FILE.jpg]",
  );
