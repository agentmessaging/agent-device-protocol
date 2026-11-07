import http from "node:http";
import { readFileSync } from "node:fs";
import { agentAddress, nonce } from "@ai-maestro/device-sdk";

// What each settings switch controls. A switch reads on only if all of its grants are on.
export const GROUPS = {
  camera: { consent: ["camera", "video"] },
  microphone: { consent: ["microphone"] },
  speaker: { consent: ["speaker"], outputs: ["speaker.say", "speaker.play"] },
  screen: { outputs: ["display.text", "display.image"] },
};
export function groupOn(peer, group) {
  const { consent = [], outputs = [] } = GROUPS[group];
  return (
    consent.every(
      (k) => (k === "camera" ? peer?.camera : peer?.media?.[k]) === true,
    ) && outputs.every((k) => peer?.outputs?.[k] === true)
  );
}
const grants = (names = [], on) =>
  Object.fromEntries(names.map((name) => [name, on]));

// shortcut: the host marks a transcript by this prefix on display.text; a typed field in the capability would be cleaner
const YOU_SAID = "You said: ";

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
      this.activity = this.frame = this.output = this.label = undefined;
      this.heard = this.picture = undefined;
      this.order = 0;
      this.live.clear();
    }
    if (
      (!peer?.camera && !peer?.media?.video) ||
      this.frame?.at + 60000 <= this.now()
    )
      this.frame = undefined;
  }
  update(peer, state, order, active, label) {
    this.sync(peer);
    if (order <= this.order) return false;
    this.order = order;
    this.activity = { state, active, at: this.now() };
    if (label) this.label = label;
    return true;
  }
  capture(peer, value) {
    this.sync(peer);
    this.frame = { at: this.now(), data: Buffer.from(value.data, "base64") };
  }
  show(peer, value) {
    this.sync(peer);
    const at = this.now();
    // Each has its own slot: the page reads five times a second and must not miss one behind another
    if (value.data) this.picture = { ...value, at };
    else if (value.text.startsWith(YOU_SAID))
      this.heard = { text: value.text.slice(YOU_SAID.length), at };
    else this.output = { ...value, at };
  }
  fresh(shown) {
    return shown && this.now() - shown.at < 60000 ? shown : null;
  }
  levels() {
    return {
      you: this.talking === true ? (this.you ?? 0) : 0,
      agent: this.voice?.level() ?? 0,
    };
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
      label: this.label ?? null,
      state: fresh ? this.activity.state : "disconnected",
      active: fresh ? (this.activity.active ?? null) : null,
      camera: peer?.camera === true,
      mediaConsent: peer?.media ?? {},
      outputConsent: peer?.outputs ?? {},
      switches: Object.fromEntries(
        Object.keys(GROUPS).map((group) => [group, groupOn(peer, group)]),
      ),
      output: this.fresh(this.output),
      heard: this.fresh(this.heard),
      picture: this.fresh(this.picture) && { at: this.picture.at },
      speaking: this.voice?.speaking() ?? false,
      talking: this.talking === true,
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
    ["/outfit.woff2", ["outfit.woff2", "font/woff2"]],
  ].map(([url, [name, type]]) => [
    url,
    { type, body: readFileSync(new URL(name, import.meta.url)) },
  ]),
);
const LOOPBACK = ["127.0.0.1", "::ffff:127.0.0.1"];
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
      ["/grant", "/stop", "/decision", "/input", "/talk", "/presence"].includes(
        req.url,
      )
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
          const sent = (await controls.talk(action)) === true;
          return res
            .writeHead(200, { "Content-Type": "application/json" })
            .end(JSON.stringify({ sent }));
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
        if (req.url === "/stop") {
          try {
            controls.revokeAll();
          } finally {
            controls.stopAll();
          }
          return res.writeHead(204).end();
        }
        const { group, on } = JSON.parse(body);
        if (!Object.hasOwn(GROUPS, group) || typeof on !== "boolean")
          return res.writeHead(400).end();
        const { consent, outputs } = GROUPS[group];
        if (consent) controls.setConsent(grants(consent, on));
        if (outputs) controls.setOutputs(grants(outputs, on));
        // Grants end media, speech and the preview when their revision changes; a recording needs telling
        if (group === "microphone" && !on) controls.stopAll();
        return res.writeHead(204).end();
      } catch {
        return res.writeHead(400).end();
      }
    }
    if (req.method !== "GET") return res.writeHead(405).end();
    if (req.url === "/levels")
      return res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(display.levels()));
    if (req.url === "/preview") {
      // The picture of the room stays on this machine, whatever address the server is bound to
      if (!controls?.preview || !LOOPBACK.includes(req.socket.remoteAddress))
        return res.writeHead(404).end();
      return controls.preview.stream(res);
    }
    const state = {
      ...display.read(),
      ...(controls
        ? {
            controlToken: token,
            canUse: typeof controls.input === "function",
            canTalk: typeof controls.talk === "function",
            preview: controls.preview?.status() ?? "none",
            pending: controls.proposals?.pending() ?? null,
          }
        : {}),
    };
    if (req.url === "/state")
      return res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(state));
    if (state.picture && req.url === "/output/" + state.picture.at)
      return res
        .writeHead(200, { "Content-Type": display.picture.mime })
        .end(Buffer.from(display.picture.data, "base64"));
    if (display.frame && req.url === "/frame/" + state.frameAt)
      return res
        .writeHead(200, { "Content-Type": "image/jpeg" })
        .end(display.frame.data);
    const asset = assets.get(req.url);
    if (!asset) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": asset.type }).end(asset.body);
  });
}
