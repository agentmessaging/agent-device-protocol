import { toolDefinitions, executeTool } from "./tools.mjs";
import { brokerCall } from "./broker-client.mjs";

// MCP stdio transport. Stdout is reserved for JSON-RPC.
let pending = "",
  initialized = false;
const running = new Map();
const respond = (message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
async function handle(message) {
  if (!message || typeof message !== "object" || Array.isArray(message))
    return respond({
      id: null,
      error: { code: -32600, message: "Invalid request" },
    });
  const { id, method, params } = message;
  if (method === "notifications/cancelled") {
    running.get(params?.requestId)?.abort();
    return;
  }
  if (id === undefined) return;
  if (message.jsonrpc !== "2.0" || !["string", "number"].includes(typeof id))
    return respond({
      id: null,
      error: { code: -32600, message: "Invalid request" },
    });
  try {
    let result;
    if (method === "initialize") {
      initialized = true;
      result = {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "ai-maestro-device", version: "0.2.0" },
      };
    } else if (!initialized) throw new Error("Initialize first");
    else if (method === "ping") result = {};
    else if (method === "tools/list") result = { tools: toolDefinitions };
    else if (method === "tools/call") {
      if (running.size >= 4 || running.has(id))
        throw new Error("Too many active requests");
      const abort = new AbortController();
      running.set(id, abort);
      try {
        result = process.env.ADP_BROKER_SOCKET
          ? await brokerCall(
              params?.name,
              params?.arguments ?? {},
              abort.signal,
            )
          : await executeTool(
              params?.name,
              params?.arguments ?? {},
              abort.signal,
            );
      } catch (error) {
        result = {
          isError: true,
          content: [{ type: "text", text: error.message }],
        };
      } finally {
        running.delete(id);
      }
    } else
      return respond({
        id,
        error: { code: -32601, message: "Method not found" },
      });
    respond({ id, result });
  } catch (error) {
    respond({ id, error: { code: -32602, message: error.message } });
  }
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  pending += chunk;
  let newline;
  while ((newline = pending.indexOf("\n")) >= 0) {
    const line = pending.slice(0, newline);
    pending = pending.slice(newline + 1);
    if (line.length > 600000) {
      respond({
        id: null,
        error: { code: -32600, message: "Request too large" },
      });
      continue;
    }
    try {
      void handle(JSON.parse(line));
    } catch {
      respond({ id: null, error: { code: -32700, message: "Invalid JSON" } });
    }
  }
  if (pending.length > 600000) process.exit(1);
});
process.stdin.on("end", () => {
  for (const abort of running.values()) abort.abort();
});
