// Run with the Linux CI runner's installed Chrome. Device never needs Chrome for its API.
import { DisplayState, displayServer } from "../apps/display/server.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const peer = {
  assignedAgent: "Lola@mini.local",
  key: "test",
  camera: true,
  media: { video: true },
};
const display = new DisplayState(() => peer);
display.update(peer, "waiting", 1);
const picture = await promisify(execFile)(
  "/usr/bin/ffmpeg",
  [
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360",
    "-frames:v",
    "1",
    "-f",
    "image2pipe",
    "-c:v",
    "mjpeg",
    "pipe:1",
  ],
  { encoding: "buffer" },
);
display.mediaStarted(peer, "video");
display.capture(peer, { data: picture.stdout.toString("base64") });
const server = displayServer(display, {
  setConsent: () => {},
  stopAll: () => {},
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const profile = await mkdtemp(join(tmpdir(), "adp-browser-"));
try {
  const { stdout } = await promisify(execFile)(
    "google-chrome",
    [
      "--headless",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--no-first-run",
      "--user-data-dir=" + profile,
      "--window-size=1280,800",
      "--virtual-time-budget=4000",
      "--dump-dom",
      "--screenshot=" + join(tmpdir(), "adp-display.png"),
      "http://127.0.0.1:" + server.address().port,
    ],
    { timeout: 30000 },
  );
  assert.match(stdout, /<h1 id="name">Lola<\/h1>/);
  assert.match(stdout, /<span id="status">Waiting for you<\/span>/);
  assert.match(
    stdout,
    /<span id="media-status" role="status">Camera live<\/span>/,
  );
  assert.match(stdout, /<div id="consent">/);
  assert.match(stdout, /<img[^>]*id="frame"[^>]*src="\/frame\/[^>]*>/);
  assert.doesNotMatch(stdout, /<img[^>]*id="frame"[^>]*hidden/);
} finally {
  server.close();
  server.closeAllConnections();
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
