import { writeFileSync } from "node:fs";
import { init, pair, self, peer } from "../../packages/sdk/state.mjs";
import { watch } from "./watch.mjs";
import { announce } from "./announce.mjs";
import { call } from "@ai-maestro/device-sdk";
const [action, arg, capability, out, ...extra] = process.argv.slice(2);
if (action === "init" && !arg) init("agent");
else if (action === "pair" && !capability) pair(arg);
else if (action === "watch" && arg && !out) await watch(arg, capability);
else if (action === "announce" && !out) await announce(arg, capability);
else if (
  (action === "discover" && !capability) ||
  (action === "invoke" && capability && !extra.length)
) {
  const result = await call(arg, self(), peer().key, capability);
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
    "Usage: init | pair DEVICE_KEY | discover URL | watch URL [ASSIGNED_AMP_ADDRESS] | announce URL [ASSIGNED_AMP_ADDRESS] | invoke URL CAPABILITY [NEW_FILE.jpg]",
  );
