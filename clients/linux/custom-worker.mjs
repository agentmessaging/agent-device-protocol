// This module path is supplied only by the local owner-validated capability loader.
import { pathToFileURL } from "node:url";
const chunks = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 65536) throw new Error("Input too large");
  chunks.push(chunk);
}
const args = JSON.parse(Buffer.concat(chunks));
const module = await import(pathToFileURL(process.argv[2]).href);
if (typeof module.handle !== "function")
  throw new Error("Handler export missing");
const value = await module.handle(args);
const result = JSON.stringify({ value });
if (!result || Buffer.byteLength(result) > 32768)
  throw new Error("Result too large");
process.stdout.write(result);
