import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { agentAddress, call } from "@ai-maestro/device-sdk";
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
  const key = device().key;
  const registration = await read(origin, controller(), key);
  const owner = agentAddress(registration.assignedAgent);
  if (recipient !== undefined && recipient !== owner)
    throw new Error("AMP events are restricted to the assigned agent");
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
      owner,
      "Device capabilities",
      JSON.stringify(event),
      "--type",
      "notification",
    ],
    { timeout: 30000, maxBuffer: 65536 },
  );
}
