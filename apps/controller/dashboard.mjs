import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  lstatSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { exchange, nonce } from "@ai-maestro/device-sdk";
import { validateChange, sameChange } from "../../packages/sdk/changes.mjs";
import { state } from "./registry.mjs";

export function publishDashboard(snapshot) {
  const dir = process.env.ADP_DASHBOARD_DIR;
  if (!dir) return;
  const statusDir = join(dir, "status");
  mkdirSync(statusDir, { recursive: true, mode: 0o755 });
  const name = createHash("sha256").update(snapshot.agent).digest("hex");
  const temp = join(statusDir, nonce() + ".tmp");
  writeFileSync(temp, JSON.stringify(snapshot), { mode: 0o644, flag: "wx" });
  renameSync(temp, join(statusDir, name + ".json"));
}
export async function processRequests(registry, identity, previous = {}) {
  const dir = process.env.ADP_DASHBOARD_DIR;
  if (!dir) return {};
  const path = join(dir, "requests");
  mkdirSync(path, { recursive: true, mode: 0o770 });
  const results = {};
  const files = readdirSync(path)
    .filter((x) => /^[a-f0-9]{48}\.json$/.test(x))
    .slice(0, 100);
  await Promise.all(
    files.map(async (filename) => {
      let request;
      try {
        const file = join(path, filename),
          info = lstatSync(file);
        if (!info.isFile() || info.size > 2048) return;
        request = JSON.parse(readFileSync(file, "utf8"));
        if (
          request.agent !== registry.agent ||
          request.id + ".json" !== filename
        )
          return;
        if (["confirmed", "rejected"].includes(previous[request.id]?.status)) {
          results[request.id] = previous[request.id];
          return;
        }
        if (
          !Number.isFinite(request.createdAt) ||
          Date.now() - request.createdAt > 300000 ||
          request.createdAt > Date.now() + 5000
        ) {
          results[request.id] = { status: "expired" };
          return;
        }
        const device = registry.devices[request.device];
        if (!device || device.key !== request.deviceKey) return;
        validateChange(request.change);
        const receipt = state.read("proposal-results.json", {})[request.id];
        if (
          receipt &&
          receipt.deviceKey === request.deviceKey &&
          receipt.assignedAgent === request.agent &&
          sameChange(receipt.change, request.change)
        ) {
          results[request.id] = {
            status: receipt.status,
            device: request.device,
            change: request.change,
          };
          return;
        }
        const response = await exchange(
          device.origin,
          identity,
          device.key,
          { type: "proposal", requestId: request.id, change: request.change },
          "proposal.ack",
          fetch,
        );
        if (response.requestId !== request.id)
          throw new Error("Uncorrelated proposal");
        results[request.id] = {
          status: response.status,
          device: request.device,
          change: request.change,
        };
      } catch {
        if (request?.id)
          results[request.id] = { status: "device_unreachable_or_changed" };
      }
    }),
  );
  return results;
}
