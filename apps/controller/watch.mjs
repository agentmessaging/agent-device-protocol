import {
  call,
  agentAddress,
  publishActivity,
  privateOrigin,
} from "@ai-maestro/device-sdk";
import { self, peer } from "../../packages/sdk/state.mjs";
import { setTimeout as sleep } from "node:timers/promises";

export function sessionState(body, agent) {
  const session = agentAddress(agent).split("@")[0];
  if (!body?.activity || !Object.hasOwn(body.activity, session))
    return "unknown";
  const status = body.activity[session]?.status;
  return status === "active"
    ? "working"
    : ["idle", "waiting"].includes(status)
      ? status
      : "unknown";
}
export async function publishSession(
  origin,
  agent,
  source,
  controller,
  device,
  active,
) {
  const name = agentAddress(agent).split("@")[0];
  const options = { redirect: "error", signal: AbortSignal.timeout(4000) };
  const directory = await fetch(
    source + "/api/agents/directory/lookup/" + encodeURIComponent(name),
    options,
  );
  if (!directory.ok)
    throw new Error("Maestro directory HTTP " + directory.status);
  const entry = (await directory.json()).agent;
  if (
    entry?.ampAddress !== agent ||
    entry.name !== name ||
    entry.source !== "local"
  )
    throw new Error(
      "Assigned AMP address must match a local Maestro directory entry on the agent host",
    );
  const response = await fetch(source + "/api/sessions/activity?local=true", {
    redirect: "error",
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error("Maestro activity HTTP " + response.status);
  const state = sessionState(await response.json(), agent);
  await publishActivity(
    origin,
    controller,
    device,
    agent,
    state,
    fetch,
    active,
  );
  return state;
}
export async function watch(origin, agent) {
  privateOrigin(origin);
  const source = privateOrigin(
    process.env.MAESTRO_URL || "http://127.0.0.1:23000",
  );
  const controller = self(),
    device = peer().key;
  const registration = await call(origin, controller, device);
  if (!registration.events?.includes("activity"))
    throw new Error(
      "Update and restart the device bridge to enable the display",
    );
  agent = agentAddress(agent ?? registration.assignedAgent);
  if (agent !== registration.assignedAgent)
    throw new Error("Requested agent differs from device assignment");
  let previous;
  for (;;) {
    let status;
    try {
      status = await publishSession(origin, agent, source, controller, device);
    } catch (error) {
      status = "Publisher unavailable: " + error.message;
    }
    if (status !== previous) console.log(status);
    previous = status;
    await sleep(3000);
  }
}
