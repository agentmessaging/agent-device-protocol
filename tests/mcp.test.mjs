import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { bridge } from "../clients/linux/server.mjs";
import { identity } from "@ai-maestro/device-sdk";

test("agent MCP negotiates, lists fixed tools and returns only configured devices", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "adp-mcp-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const controller = identity(),
    device = identity();
  const bridgeServer = bridge(
    device,
    () => ({
      key: controller.key,
      assignedAgent: "lola@mini.local",
      camera: true,
    }),
    {
      cameraReady: () => true,
      indicatorReady: () => true,
      indicate: async () => {},
      snapshot: async () => ({ mime: "image/jpeg", data: "/9j/2Q==" }),
    },
  );
  bridgeServer.listen(0, "127.0.0.1");
  await once(bridgeServer, "listening");
  t.after(() => {
    bridgeServer.close();
    bridgeServer.closeAllConnections();
  });
  writeFileSync(join(dir, "identity.json"), JSON.stringify(controller));
  writeFileSync(
    join(dir, "controller.json"),
    JSON.stringify({ agent: "lola@mini.local", devices: {} }),
  );
  const child = spawn(process.execPath, ["apps/controller/mcp.mjs"], {
    env: { ...process.env, ADP_HOME: dir, ADP_BROKER_SOCKET: "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  const responses = new Map();
  let pending = "";
  child.stdout.on("data", (chunk) => {
    pending += chunk;
    let newline;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const message = JSON.parse(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      responses.get(message.id)?.(message);
    }
  });
  const request = (message) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("MCP timed out")),
        3000,
      );
      responses.set(message.id, (value) => {
        clearTimeout(timeout);
        resolve(value);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
    });
  assert.equal(
    (
      await request({
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      })
    ).result.protocolVersion,
    "2025-06-18",
  );
  const tools = (await request({ id: 2, method: "tools/list" })).result.tools;
  assert.ok(tools.some((t) => t.name === "device_snapshot"));
  assert.ok(tools.every((t) => !t.name.includes("shell")));
  const result = (
    await request({
      id: 3,
      method: "tools/call",
      params: { name: "device_list", arguments: {} },
    })
  ).result;
  assert.equal(result.content[0].text, "[]");
  const bad = (
    await request({
      id: 4,
      method: "tools/call",
      params: {
        name: "device_health",
        arguments: { device: "someone-elses-device" },
      },
    })
  ).result;
  assert.equal(bad.isError, true);
  writeFileSync(
    join(dir, "controller.json"),
    JSON.stringify({
      agent: "lola@mini.local",
      devices: {
        macbook: {
          origin: "http://127.0.0.1:" + bridgeServer.address().port,
          key: device.key,
        },
      },
    }),
  );
  writeFileSync(
    join(dir, "active.json"),
    JSON.stringify({ key: device.key, epoch: "test" }),
  );
  const snapshot = (
    await request({
      id: 5,
      method: "tools/call",
      params: { name: "device_snapshot", arguments: { device: "macbook" } },
    })
  ).result;
  assert.deepEqual(snapshot.content, [
    { type: "image", mimeType: "image/jpeg", data: "/9j/2Q==" },
  ]);
  child.stdin.end();
});
