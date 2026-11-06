import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dir, self, peer } from "../../packages/sdk/state.mjs";
import {
  call,
  privateOrigin,
  nonce,
  agentAddress,
  publicKey,
} from "@ai-maestro/device-sdk";

export function config() {
  const value = JSON.parse(readFileSync(join(dir, "controller.json"), "utf8"));
  agentAddress(value.agent);
  if (!value.devices || Array.isArray(value.devices))
    throw new Error("Invalid device registry");
  if (Object.keys(value.devices).length > 16)
    throw new Error("A controller supports at most 16 devices");
  for (const [name, d] of Object.entries(value.devices)) {
    deviceName(name);
    privateOrigin(d.origin);
    publicKey(d.key);
  }
  return value;
}
export function deviceName(value) {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)
  )
    throw new Error(
      "Use a device name containing letters, digits, hyphens or underscores",
    );
  return value;
}
export function save(name, value) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, nonce() + ".tmp");
  writeFileSync(temp, JSON.stringify(value, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  renameSync(temp, join(dir, name));
}
export async function addDevice(name, origin) {
  deviceName(name);
  privateOrigin(origin);
  const key = peer().key;
  const registration = await call(origin, self(), key);
  let current = {
    agent: agentAddress(registration.assignedAgent),
    devices: {},
  };
  try {
    current = config();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (current.agent !== registration.assignedAgent)
    throw new Error("This controller registry belongs to another agent");
  if (
    !Object.hasOwn(current.devices, name) &&
    Object.keys(current.devices).length >= 16
  )
    throw new Error("Device limit reached");
  current.devices[name] = { origin, key };
  save("controller.json", current);
  console.log("Configured " + name + " for " + current.agent);
  return current;
}
export function optionalState(name, fallback) {
  try {
    return JSON.parse(readFileSync(join(dir, name), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return fallback;
  }
}
