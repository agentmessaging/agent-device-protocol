import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { publishDashboard, processRequests } from "./dashboard.mjs";
import { call, privateOrigin } from "@ai-maestro/device-sdk";
import { config, optionalState, save } from "./registry.mjs";
import { self, dir } from "../../packages/sdk/state.mjs";
import { publishSession } from "./watch.mjs";

const exec = promisify(execFile);
const healthFetch = (url, options) =>
  fetch(url, {
    ...options,
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(4000)]),
  });
const healthCall = (origin, identity, key, capability) =>
  call(origin, identity, key, capability, healthFetch);
export function transition(previous, observed, now) {
  const failures = observed.online ? 0 : (previous?.failures ?? 0) + 1;
  const state = observed.online
    ? "online"
    : observed.revoked
      ? "revoked"
      : failures >= 3
        ? "offline"
        : (previous?.state ?? "connecting");
  return {
    ...previous,
    ...observed,
    failures,
    state,
    lastSeen: observed.online ? now : (previous?.lastSeen ?? null),
    checkedAt: now,
  };
}
export async function sendNotice(agent, name, state) {
  await exec(
    "amp-send",
    [
      agent,
      "Agent home " + state,
      JSON.stringify({
        type: "device." + state,
        device: name,
        assignedAgent: agent,
      }),
      "--type",
      "notification",
    ],
    { timeout: 15000, maxBuffer: 65536 },
  );
}
export async function monitorOnce(deps = {}) {
  const registry = (deps.config ?? config)(),
    identity = (deps.self ?? self)();
  const load = deps.load ?? optionalState,
    write = deps.save ?? save;
  const previous = load("device-status.json", { devices: {} });
  const delivered = load("notifications.json", {});
  const records = {};
  await Promise.all(
    Object.entries(registry.devices).map(async ([name, device]) => {
      let observed;
      try {
        const r = await (deps.call ?? healthCall)(
          device.origin,
          identity,
          device.key,
        );
        if (r.assignedAgent !== registry.agent)
          throw new Error("403 owner changed");
        const health = await (deps.call ?? healthCall)(
          device.origin,
          identity,
          device.key,
          "device.health",
        );
        if (!health.ok) throw new Error("Health unavailable");
        observed = {
          online: true,
          bootId: r.bootId,
          assignedAgent: r.assignedAgent,
          capabilities: r.capabilities,
          streams: r.streams,
          permissions: r.permissions ?? {},
          platform: health.value.platform,
        };
      } catch (error) {
        observed = {
          online: false,
          assignedAgent: registry.agent,
          revoked: /403/.test(error.message),
        };
      }
      const record = transition(
        previous.devices[name],
        observed,
        new Date().toISOString(),
      );
      records[name] = {
        ...record,
        name,
        origin: device.origin,
        key: device.key,
      };
      if (["online", "offline", "revoked"].includes(record.state)) {
        const event =
          registry.agent +
          "|" +
          device.key +
          "|" +
          (record.bootId ?? "") +
          "|" +
          record.state;
        if (delivered[name] !== event) {
          try {
            await (deps.notify ?? sendNotice)(
              registry.agent,
              name,
              record.state,
            );
            delivered[name] = event;
            write("notifications.json", delivered);
          } catch {
            records[name].notificationPending = true;
          }
        }
      }
    }),
  );
  const requests = await (deps.requests ?? processRequests)(
    registry,
    identity,
    previous.requests ?? {},
  );
  const snapshot = {
    requests,
    agent: registry.agent,
    updatedAt: new Date().toISOString(),
    devices: records,
  };
  write("device-status.json", snapshot);
  (deps.publish ?? publishDashboard)(snapshot);
  return snapshot;
}
export async function monitor() {
  const lock = join(dir, "monitor.lock");
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let pid;
    try {
      pid = Number(readFileSync(join(lock, "pid"), "utf8"));
      process.kill(pid, 0);
    } catch (error) {
      if (error.code !== "ESRCH")
        throw new Error(
          "Monitor lock exists; check the running monitor before removing " +
            lock,
        );
      rmSync(lock, { recursive: true });
      mkdirSync(lock, { mode: 0o700 });
      pid = undefined;
    }
    if (pid) throw new Error("Monitor already running");
  }
  writeFileSync(join(lock, "pid"), String(process.pid), { mode: 0o600 });
  const abort = new AbortController();
  process.once("SIGTERM", () => abort.abort());
  process.once("SIGINT", () => abort.abort());
  try {
    while (!abort.signal.aborted) {
      try {
        const state = await monitorOnce();
        const source = privateOrigin(
          process.env.MAESTRO_URL || "http://127.0.0.1:23000",
        );
        const identity = self();
        await Promise.all(
          Object.values(state.devices)
            .filter((d) => d.state === "online")
            .map(async (d) => {
              try {
                await publishSession(
                  d.origin,
                  state.agent,
                  source,
                  identity,
                  d.key,
                );
              } catch {
                /* Display expires on source failure. Device health is independent. */
              }
            }),
        );
      } catch (error) {
        console.error("Monitor: " + error.message);
      }
      await sleep(3000, undefined, { signal: abort.signal }).catch(() => {});
    }
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
