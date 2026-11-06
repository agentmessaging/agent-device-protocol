import http from "node:http";
import { readFileSync } from "node:fs";
import { agentAddress, nonce } from "@ai-maestro/device-sdk";

export class DisplayState {
  constructor(getPeer, now = Date.now) {
    this.getPeer = getPeer;
    this.now = now;
    this.live = new Set();
    this.indicators = new Map();
    this.indicatorId = nonce();
  }
  ackPresence(visible, indicatorId) {
    this.visible = visible === true;
    this.seenAt = this.now();
    if (this.visible && indicatorId === this.indicatorId)
      this.indicatorAck = indicatorId;
  }
  indicatorReady() {
    return this.visible === true && this.now() - this.seenAt < 1000;
  }
  keepIndicator(kind) {
    this.indicators.set(kind, this.now() + 3000);
  }
  async indicate(kind) {
    if (!this.indicatorReady())
      throw new Error("Visible local indicator unavailable");
    this.indicatorId = nonce();
    this.indicators.set(kind, this.now() + 3000);
    const deadline = Date.now() + 1000;
    while (this.indicatorAck !== this.indicatorId) {
      if (!this.indicatorReady() || Date.now() > deadline)
        throw new Error("Local indicator was not displayed");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    this.indicators.set(kind, this.now() + 3000);
  }
  sync(peer) {
    const owner =
      peer && JSON.stringify([peer.key, peer.assignedAgent, peer.revision]);
    if (owner !== this.owner) {
      this.owner = owner;
      this.activity = this.frame = this.output = undefined;
      this.order = 0;
      this.live.clear();
    }
    if (
      (!peer?.camera && !peer?.media?.video) ||
      this.frame?.at + 60000 <= this.now()
    )
      this.frame = undefined;
  }
  update(peer, state, order, active) {
    this.sync(peer);
    if (order <= this.order) return false;
    this.order = order;
    this.activity = { state, active, at: this.now() };
    return true;
  }
  capture(peer, value) {
    this.sync(peer);
    this.frame = { at: this.now(), data: Buffer.from(value.data, "base64") };
  }
  show(peer, value) {
    this.sync(peer);
    this.output = { ...value, at: this.now() };
  }
  mediaStarted(peer, kind) {
    this.sync(peer);
    this.live.add(kind);
  }
  mediaStopped(kind) {
    this.live.delete(kind);
    if (kind === "video") this.frame = undefined;
  }
  read() {
    let peer;
    try {
      peer = this.getPeer();
      agentAddress(peer.assignedAgent);
    } catch {
      peer = undefined;
    }
    this.sync(peer);
    const fresh = this.activity && this.now() - this.activity.at < 15000;
    return {
      agent: peer?.assignedAgent ?? null,
      state: fresh ? this.activity.state : "disconnected",
      active: fresh ? (this.activity.active ?? null) : null,
      camera: peer?.camera === true,
      mediaConsent: peer?.media ?? {},
      outputConsent: peer?.outputs ?? {},
      output:
        this.output && this.now() - this.output.at < 60000 ? this.output : null,
      live: [...this.live],
      indicators: [
        ...new Set(
          [...this.live]
            .filter((k) => k !== "speaker")
            .concat(
              [...this.indicators]
                .filter(([, until]) => until > this.now())
                .map(([kind]) => kind),
            ),
        ),
      ],
      indicatorId: this.indicatorId,
      frameAt: this.frame?.at ?? null,
    };
  }
}
const assets = new Map(
  [
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/screen.css", ["screen.css", "text/css"]],
    ["/screen.js", ["screen.js", "text/javascript"]],
  ].map(([url, [name, type]]) => [
    url,
    { type, body: readFileSync(new URL(name, import.meta.url)) },
  ]),
);
export function displayServer(display, controls) {
  const token = nonce();
  return http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
    );
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.headers.host !== "127.0.0.1:" + req.socket.localPort)
      return res.writeHead(403).end();
    if (
      req.method === "POST" &&
      controls &&
      [
        "/consent",
        "/stop",
        "/decision",
        "/used",
        "/input",
        "/talk",
        "/outputs",
        "/presence",
      ].includes(req.url)
    ) {
      if (
        req.headers.origin !== "http://" + req.headers.host ||
        req.headers["x-display-token"] !== token
      )
        return res.writeHead(403).end();
      try {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > (req.url === "/input" ? 25000 : 1024))
            return res.writeHead(413).end();
        }
        if (req.url === "/presence") {
          const p = JSON.parse(body);
          display.ackPresence(p.visible, p.indicatorId);
          return res.writeHead(204).end();
        }
        if (req.url === "/outputs") {
          controls.setOutputs(JSON.parse(body));
          return res.writeHead(204).end();
        }
        if (req.url === "/input") {
          const input = JSON.parse(body);
          if (Object.keys(input).join() !== "text")
            throw new Error("Invalid input");
          await controls.input(input.text);
          return res.writeHead(204).end();
        }
        if (req.url === "/talk") {
          const { action } = JSON.parse(body);
          if (!["start", "stop"].includes(action) || !controls.talk)
            return res.writeHead(400).end();
          await controls.talk(action);
          return res.writeHead(204).end();
        }
        if (req.url === "/used") {
          await controls.used();
          return res.writeHead(204).end();
        }
        if (req.url === "/decision") {
          const decision = JSON.parse(body);
          if (typeof decision.approve !== "boolean")
            return res.writeHead(400).end();
          controls.proposals.decide(decision.id, decision.approve);
          controls.stopAll();
          await controls.afterDecision?.(controls.proposals.receipt());
          return res.writeHead(204).end();
        }
        const consent =
          req.url === "/stop"
            ? { video: false, microphone: false, speaker: false }
            : JSON.parse(body);
        controls.setConsent(consent);
        controls.stopAll();
        return res.writeHead(204).end();
      } catch {
        return res.writeHead(400).end();
      }
    }
    if (req.method !== "GET") return res.writeHead(405).end();
    const state = {
      ...display.read(),
      ...(controls
        ? {
            controlToken: token,
            canUse: typeof controls.used === "function",
            canTalk: typeof controls.talk === "function",
            pending: controls.proposals?.pending() ?? null,
          }
        : {}),
    };
    if (req.url === "/state")
      return res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(state));
    if (state.output?.data && req.url === "/output/" + state.output.at)
      return res
        .writeHead(200, { "Content-Type": state.output.mime })
        .end(Buffer.from(state.output.data, "base64"));
    if (display.frame && req.url === "/frame/" + state.frameAt)
      return res
        .writeHead(200, { "Content-Type": "image/jpeg" })
        .end(display.frame.data);
    const asset = assets.get(req.url);
    if (!asset) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": asset.type }).end(asset.body);
  });
}
