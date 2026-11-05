import http from "node:http";
import { readFileSync } from "node:fs";
import { agentAddress } from "@ai-maestro/device-sdk";

export class DisplayState {
  constructor(getPeer, now = Date.now) {
    this.getPeer = getPeer;
    this.now = now;
  }
  sync(peer) {
    const owner =
      peer && JSON.stringify([peer.key, peer.assignedAgent, peer.revision]);
    if (owner !== this.owner) {
      this.owner = owner;
      this.activity = this.frame = undefined;
      this.order = 0;
    }
    if (!peer?.camera || this.frame?.at + 60000 <= this.now())
      this.frame = undefined;
  }
  update(peer, state, order) {
    this.sync(peer);
    if (order <= this.order) return false;
    this.order = order;
    this.activity = { state, at: this.now() };
    return true;
  }
  capture(peer, value) {
    this.sync(peer);
    this.frame = { at: this.now(), data: Buffer.from(value.data, "base64") };
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
      camera: peer?.camera === true,
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
export function displayServer(display) {
  return http.createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
    );
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (
      req.method !== "GET" ||
      req.headers.host !== "127.0.0.1:" + req.socket.localPort
    )
      return res.writeHead(403).end();
    const state = display.read();
    if (req.url === "/state")
      return res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(state));
    if (display.frame && req.url === "/frame/" + state.frameAt)
      return res
        .writeHead(200, { "Content-Type": "image/jpeg" })
        .end(display.frame.data);
    const asset = assets.get(req.url);
    if (!asset) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": asset.type }).end(asset.body);
  });
}
