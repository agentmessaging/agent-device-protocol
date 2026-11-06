import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  validateSchema,
  validateArguments,
} from "../../packages/sdk/capabilities.mjs";
export function customName(name) {
  return (
    typeof name === "string" &&
    /^custom\.[a-z][a-z0-9_-]{0,31}\.[a-z][a-z0-9_-]{0,31}$/.test(name)
  );
}
function safe(path, directory = false) {
  const s = lstatSync(path);
  if (
    s.isSymbolicLink() ||
    s.uid !== process.getuid() ||
    s.mode & 0o022 ||
    (directory ? !s.isDirectory() : !s.isFile())
  )
    throw new Error("Unsafe capability file");
  return s;
}
export function loadCustom(directory) {
  const definitions = new Map();
  try {
    safe(directory, true);
  } catch (error) {
    if (error.code === "ENOENT") return definitions;
    throw error;
  }
  for (const file of readdirSync(directory)
    .filter((f) => f.endsWith(".json"))
    .slice(0, 32)) {
    const path = join(directory, file);
    if (safe(path).size > 16384) throw new Error("Definition too large");
    const d = JSON.parse(readFileSync(path, "utf8"));
    if (
      Object.keys(d).some(
        (k) =>
          ![
            "name",
            "description",
            "sensor",
            "activation",
            "args",
            "timeoutMs",
            "module",
          ].includes(k),
      ) ||
      !customName(d.name) ||
      typeof d.description !== "string" ||
      Buffer.byteLength(d.description) > 256 ||
      typeof d.sensor !== "boolean" ||
      !["active", "any"].includes(d.activation) ||
      (d.sensor && d.activation !== "active") ||
      !Number.isInteger(d.timeoutMs) ||
      d.timeoutMs < 100 ||
      d.timeoutMs > 10000 ||
      !/^[-a-zA-Z0-9_]+\.mjs$/.test(d.module)
    )
      throw new Error("Invalid custom capability");
    validateSchema(d.args);
    const module = join(directory, d.module);
    safe(module);
    if (definitions.has(d.name)) throw new Error("Duplicate capability");
    definitions.set(d.name, { ...d, module });
  }
  return definitions;
}
export class CustomCapabilities {
  constructor(directory) {
    this.directory = directory;
    this.running = 0;
  }
  definitions(peer) {
    try {
      return Object.fromEntries(
        [...loadCustom(this.directory)]
          .filter(([name]) => peer.custom?.[name] === true)
          .map(([name, d]) => [
            name,
            {
              description: d.description,
              sensor: d.sensor,
              activation: d.activation,
              args: d.args,
              timeoutMs: d.timeoutMs,
            },
          ]),
      );
    } catch (error) {
      this.lastError = error.message;
      return {};
    }
  }
  async invoke(name, args, peer, signal) {
    const d = loadCustom(this.directory).get(name);
    if (!d || peer.custom?.[name] !== true)
      throw new Error("Capability denied");
    validateArguments(d.args, args);
    if (this.running >= 4) throw new Error("Custom capabilities busy");
    this.running++;
    try {
      return await new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            fileURLToPath(new URL("custom-worker.mjs", import.meta.url)),
            d.module,
          ],
          { stdio: ["pipe", "pipe", "ignore"], detached: true },
        );
        let done = false,
          size = 0;
        const chunks = [];
        const stop = () => {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        };
        const timer = setTimeout(() => {
          stop();
          finish(new Error("Capability timed out"));
        }, d.timeoutMs);
        const abort = () => {
          stop();
          finish(new Error("Capability stopped"));
        };
        signal?.addEventListener("abort", abort, { once: true });
        function finish(error, value) {
          if (done) return;
          done = true;
          stop();
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          error ? reject(error) : resolve(value);
        }
        child.stdin.on("error", () => {});
        child.stdin.end(JSON.stringify(args));
        child.stdout.on("data", (chunk) => {
          size += chunk.length;
          if (size > 32768) {
            stop();
            finish(new Error("Result too large"));
          } else chunks.push(chunk);
        });
        child.once("error", finish);
        child.once("close", (code) => {
          try {
            if (code !== 0) throw new Error("Capability failed");
            finish(null, JSON.parse(Buffer.concat(chunks)).value);
          } catch (error) {
            finish(error);
          }
        });
        if (signal?.aborted) abort();
      });
    } finally {
      this.running--;
    }
  }
}
