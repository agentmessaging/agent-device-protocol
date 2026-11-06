import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { identity, nonce, publicKey } from "./index.mjs";

const dir =
  process.env.ADP_HOME || join(homedir(), ".config", "ai-maestro-device");
export function self() {
  return JSON.parse(readFileSync(join(dir, "identity.json"), "utf8"));
}
export function peer() {
  return JSON.parse(readFileSync(join(dir, "peer.json"), "utf8"));
}
export function init(role = "device") {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(join(dir, "identity.json"), JSON.stringify(identity()), {
      mode: 0o600,
      flag: "wx",
    });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const key = self().key;
  console.error(`${role === "agent" ? "Agent" : "Device"} public key (safe to share)
State directory: ${dir}
Fingerprint: ${fingerprint(key)}`);
  console.log(key);
}
export function pair(key, { camera = false, assignedAgent } = {}) {
  publicKey(key);
  self();
  if (assignedAgent) {
    let current;
    try {
      current = peer();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (
      current?.assignedAgent &&
      current.assignedAgent !== assignedAgent &&
      current.key === key
    )
      throw new Error("Transfer requires the new agent's own public key");
  }
  const temp = join(dir, nonce() + ".tmp");
  writeFileSync(
    temp,
    JSON.stringify({
      key,
      camera,
      assignedAgent,
      revision: assignedAgent ? nonce() : undefined,
    }),
    {
      mode: 0o600,
      flag: "wx",
    },
  );
  renameSync(temp, join(dir, "peer.json"));
  console.error(`Saved ${assignedAgent ? "assignment to " + assignedAgent : "device pairing"}
Peer public key: ${key}
Fingerprint: ${fingerprint(key)}
Policy file: ${join(dir, "peer.json")}`);
}
function fingerprint(key) {
  return createHash("sha256")
    .update(Buffer.from(key, "base64url"))
    .digest("hex")
    .slice(0, 16);
}
