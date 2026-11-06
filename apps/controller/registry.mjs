import { dir, self, peer } from "../../packages/sdk/state.mjs";
import { ControllerState } from "../../packages/sdk/controller-state.mjs";
import { call, agentAddress } from "@ai-maestro/device-sdk";
export const state = new ControllerState(dir);
export function config() {
  const value = state.registry();
  return {
    agent: value.agent,
    devices: Object.fromEntries(
      Object.values(value.devices)
        .filter((d) => d.origin !== null)
        .map((d) => [d.name, d]),
    ),
    active: state.active().key,
  };
}
export function save(name, value) {
  state.write(name, value);
}
export function optionalState(name, fallback) {
  return state.read(name, fallback);
}
export async function addDevice(name, origin, deviceKey = peer().key) {
  const registration = await call(origin, self(), deviceKey);
  state.add(name, origin, deviceKey, agentAddress(registration.assignedAgent));
  console.log("Configured " + name + " for " + registration.assignedAgent);
  return config();
}
export function jumpDevice(name) {
  const device = name === "none" ? null : config().devices[name];
  if (name !== "none" && !device) throw new Error("Unknown device");
  const active = state.jump(device?.key ?? null);
  return { active: device?.name ?? null, ...active };
}
