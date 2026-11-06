import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dir } from "../../packages/sdk/state.mjs";
import { config } from "./registry.mjs";
import { nonce } from "@ai-maestro/device-sdk";

export function installMcp(workspace) {
  if (!workspace) throw new Error("Provide the agent working directory");
  if (!process.env.ADP_BROKER_SOCKET) config();
  const root = resolve(workspace),
    target = join(root, ".mcp.json"),
    lock = target + ".lock";
  mkdirSync(root, { recursive: true });
  const mcp = {
    command: process.execPath,
    args: [fileURLToPath(new URL("./mcp.mjs", import.meta.url))],
    env: process.env.ADP_BROKER_SOCKET
      ? { ADP_BROKER_SOCKET: process.env.ADP_BROKER_SOCKET }
      : { ADP_HOME: dir },
  };
  writeFileSync(lock, "", { flag: "wx", mode: 0o600 });
  try {
    let current = {};
    try {
      current = JSON.parse(readFileSync(target, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const existing = current.mcpServers?.["ai-maestro-device"];
    if (existing && JSON.stringify(existing) !== JSON.stringify(mcp))
      throw new Error(
        "Existing ai-maestro-device configuration differs; review it before changing the signer",
      );
    const temp = target + "." + nonce() + ".tmp";
    writeFileSync(
      temp,
      JSON.stringify(
        {
          ...current,
          mcpServers: { ...current.mcpServers, "ai-maestro-device": mcp },
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
    renameSync(temp, target);
    console.log(
      "Installed ai-maestro-device MCP configuration in " +
        target +
        "; reopen the agent session and approve the local MCP server.",
    );
  } finally {
    rmSync(lock, { force: true });
  }
}
