import http from "node:http";
import { agentAddress, nonce, open, seal } from "@ai-maestro/device-sdk";
import { cameraReady, snapshot } from "./hardware.mjs";

export function bridge(
  self,
  getPeer,
  hardware = { cameraReady, snapshot },
  display,
) {
  const challenges = new Map();
  let captureOwner;
  let sequence = 0;
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
            if (expiry.until <= now) challenges.delete(key);
          if (challenges.size >= 512) return reply(429, { error: "busy" });
          const challenge = nonce();
          challenges.set(challenge, { until: now + 30000, order: ++sequence });
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
        const ticket = challenges.get(msg?.challenge);
        if (
          msg?.to !== self.key ||
          !/^[a-f0-9]{48}$/.test(msg.id) ||
          !(ticket?.until > Date.now())
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
            ...(display ? { events: ["activity"] } : {}),
          });
        if (msg.type === "activity" && display) {
          if (
            msg.assignedAgent !== assignedAgent ||
            !["working", "waiting", "idle", "unknown"].includes(msg.state) ||
            Object.keys(msg).some(
              (k) =>
                ![
                  "type",
                  "id",
                  "challenge",
                  "to",
                  "assignedAgent",
                  "state",
                ].includes(k),
            )
          )
            return reply(400, { error: "invalid_activity" });
          if (!display.update(peer, msg.state, ticket.order))
            return reply(409, { error: "superseded" });
          return result({ type: "activity.ack" });
        }
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
            current.revision !== peer.revision ||
            current.camera !== true
          )
            return reply(403, { error: "grant_revoked" });
          display?.capture(peer, value);
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
