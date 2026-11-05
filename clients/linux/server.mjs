import http from "node:http";
import { agentAddress, nonce, open, seal } from "@ai-maestro/device-sdk";
import { cameraReady, snapshot } from "./hardware.mjs";

export function bridge(self, getPeer, hardware = { cameraReady, snapshot }) {
  const challenges = new Map();
  let captureOwner;
  const server = http.createServer(
    { requestTimeout: 12000, headersTimeout: 10000, maxHeaderSize: 8192 },
    async (req, res) => {
      const reply = (status, data) =>
        res
          .writeHead(status, {
            "content-type": "application/json",
            "cache-control": "no-store",
          })
          .end(JSON.stringify(data));
      try {
        if (req.method === "GET" && req.url === "/v1/challenge") {
          const now = Date.now();
          for (const [key, expiry] of challenges)
            if (expiry <= now) challenges.delete(key);
          if (challenges.size >= 512) return reply(429, { error: "busy" });
          const challenge = nonce();
          challenges.set(challenge, now + 30000);
          return reply(200, { challenge });
        }
        if (req.method !== "POST" || req.url !== "/v1/request")
          return reply(404, { error: "unknown_route" });
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 8192) return reply(413, { error: "too_large" });
          chunks.push(chunk);
        }
        const peer = getPeer();
        const assignedAgent = agentAddress(peer.assignedAgent);
        const msg = open(JSON.parse(Buffer.concat(chunks)), peer.key);
        if (
          msg?.to !== self.key ||
          !/^[a-f0-9]{48}$/.test(msg.id) ||
          !(challenges.get(msg.challenge) > Date.now())
        )
          return reply(403, { error: "invalid_request" });
        challenges.delete(msg.challenge);
        if (
          captureOwner &&
          (captureOwner.key !== peer.key ||
            captureOwner.assignedAgent !== assignedAgent)
        )
          return reply(409, { error: "transfer_draining" });
        const base = { to: peer.key, id: msg.id, challenge: msg.challenge };
        const result = (data) =>
          reply(200, seal({ ...base, ...data }, self.secret));
        const capabilities = ["device.health"];
        if (peer.camera === true && hardware.cameraReady())
          capabilities.push("camera.snapshot");
        if (msg.type === "discover")
          return result({
            type: "register",
            version: 1,
            assignedAgent,
            capabilities,
            streams: [],
          });
        const allowedFields = ["to", "id", "challenge", "type", "capability"];
        if (
          msg.type !== "invoke" ||
          Object.keys(msg).some((k) => !allowedFields.includes(k)) ||
          !capabilities.includes(msg.capability)
        )
          return result({ type: "result", ok: false, error: "denied" });
        if (msg.capability === "device.health")
          return result({
            type: "result",
            ok: true,
            value: { status: "ok", platform: process.platform },
          });
        if (captureOwner)
          return result({
            type: "result",
            ok: false,
            error: "hardware_unavailable",
          });
        captureOwner = { key: peer.key, assignedAgent };
        try {
          const value = await hardware.snapshot();
          const current = getPeer();
          if (
            current.key !== peer.key ||
            current.assignedAgent !== assignedAgent ||
            current.camera !== true
          )
            return reply(403, { error: "grant_revoked" });
          return result({ type: "result", ok: true, value });
        } catch {
          return result({
            type: "result",
            ok: false,
            error: "hardware_unavailable",
          });
        } finally {
          captureOwner = undefined;
        }
      } catch {
        return reply(403, { error: "invalid_request" });
      }
    },
  );
  server.maxConnections = 64;
  return server;
}
