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
  media: { video: true, microphone: true },
};
const display = new DisplayState(() => peer);
display.update(peer, "waiting", 1);
display.mediaStarted(peer, "video");
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
  assert.match(stdout, /<p id="status" role="status">Here with you<\/p>/);
  assert.match(stdout, /<p id="eye-note">Lola is looking<\/p>/);
  assert.match(stdout, /<div id="capture-indicator" role="status">Camera in use<\/div>/);
  assert.match(stdout, /<h2 id="settings-title">What Lola can use<\/h2>/);
  assert.match(stdout, /data-group="camera" aria-checked="true"/);
  assert.match(stdout, /data-group="screen" aria-checked="false"/);
  assert.match(stdout, /<button id="talk"[^>]*aria-label="Talk to Lola"/);
  assert.doesNotMatch(stdout, /class="demo"/);
} finally {
  server.close();
  server.closeAllConnections();
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
