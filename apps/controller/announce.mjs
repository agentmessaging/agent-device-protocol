import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { call } from "@ai-maestro/device-sdk";
import { self, peer } from "../../packages/sdk/state.mjs";

// Operator-triggered AMP event. Run in the intended agent's AMP environment.
export async function announce(
  origin,
  recipient,
  {
    read = call,
    send = promisify(execFile),
    controller = self,
    device = peer,
  } = {},
) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._+-]*@[A-Za-z0-9][A-Za-z0-9.-]*$/.test(recipient)
  )
    throw new Error("Expected full AMP recipient address");
  const key = device().key;
  const registration = await read(origin, controller(), key);
  const event = {
    type: "device.registered",
    version: 1,
    key,
    capabilities: registration.capabilities,
    observedRequest: registration.id,
  };
  await send(
    "amp-send",
    [
      recipient,
      "Device capabilities",
      JSON.stringify(event),
      "--type",
      "notification",
    ],
    { timeout: 30000, maxBuffer: 65536 },
  );
}
