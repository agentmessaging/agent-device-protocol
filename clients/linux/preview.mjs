import { previewCamera } from "./media.mjs";

const BOUNDARY = "frame";
const MAX_QUEUED = 1024 * 1024;
const CHECK_MS = 100; // the protocol's cancel bound: a lost grant or a hidden screen ends capture within about 1.1 s
const RETRY_MS = 2000;

/**
 * The person's own picture on the device's screen: MJPEG, multipart, into one <img>.
 * It never reaches the agent. Capture runs only while a screen is watching, the camera
 * grants are on and no one else has the camera, and /dev/video0 has one user at a time.
 */
export class CameraPreview {
  constructor({ allowed, ready, enabled = true, capture = previewCamera }) {
    Object.assign(this, { allowed, ready, enabled, capture });
    this.clients = new Set();
    this.holds = 0;
    this.retryAt = 0;
  }
  status() {
    if (!this.ready()) return "none";
    return this.enabled ? "ready" : "disabled";
  }
  stream(res) {
    if (this.status() !== "ready") return res.writeHead(404).end();
    res.writeHead(200, {
      "Content-Type": "multipart/x-mixed-replace; boundary=" + BOUNDARY,
    });
    res.flushHeaders();
    this.clients.add(res);
    res.on("close", () => {
      this.clients.delete(res);
      this.sync();
    });
    this.sync();
  }
  frame(jpeg) {
    for (const res of this.clients) {
      // A screen that cannot keep up skips frames; nothing queues
      if (res.writableLength > MAX_QUEUED) continue;
      res.write(
        `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`,
      );
      res.write(jpeg);
      res.write("\r\n");
    }
  }
  sync() {
    const wanted = this.clients.size > 0 && !this.holds && this.allowed();
    if (wanted && !this.running && Date.now() >= this.retryAt) this.start();
    if (!wanted) this.halt();
    if (this.clients.size && !this.timer)
      this.timer = setInterval(() => this.sync(), CHECK_MS);
    if (!this.clients.size) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
  start() {
    const running = {};
    running.closed = new Promise((resolve) => {
      running.stop = this.capture(
        (jpeg) => this.frame(jpeg),
        () => {
          // A camera that fails must not respawn ffmpeg in a tight loop
          if (!running.halted) this.retryAt = Date.now() + RETRY_MS;
          if (this.running === running) this.running = undefined;
          resolve();
        },
      );
    });
    this.running = running;
  }
  halt() {
    if (!this.running || this.running.halted) return;
    this.running.halted = true;
    this.running.stop();
  }
  /** Gives up the camera, and resolves once ffmpeg has really closed it. */
  async pause() {
    this.holds++;
    this.halt();
    await this.running?.closed;
  }
  resume() {
    this.holds--;
    this.sync();
  }
  async exclusive(use) {
    await this.pause();
    try {
      return await use();
    } finally {
      this.resume();
    }
  }
  close() {
    for (const res of this.clients) res.destroy();
    this.clients.clear();
    this.sync();
  }
}
