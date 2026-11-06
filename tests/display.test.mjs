import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { DisplayState, displayServer } from "../apps/display/server.mjs";
import { publishSession, sessionState } from "../apps/controller/watch.mjs";
import { bridge } from "../clients/linux/server.mjs";
import { call, publishActivity, identity } from "@ai-maestro/device-sdk";

async function listen(t, server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      }),
  );
  return "http://127.0.0.1:" + server.address().port;
}
test("real HTTP publisher, signed bridge, display and camera preview", async (t) => {
  const controller = identity(),
    device = identity();
  let policy = {
    key: controller.key,
    assignedAgent: "lola@mini.local",
    camera: true,
  };
  let now = 1000;
  const display = new DisplayState(
    () => policy,
    () => now,
  );
  const jpeg = Buffer.from([255, 216, 255, 217]);
  const hardware = {
    cameraReady: () => true,
    indicatorReady: () => true,
    indicate: async () => {},
    snapshot: async () => ({
      mime: "image/jpeg",
      data: jpeg.toString("base64"),
    }),
  };
  const origin = await listen(
    t,
    bridge(device, () => policy, hardware, display),
  );
  const screen = await listen(t, displayServer(display));
  const read = async () => (await fetch(screen + "/state")).json();
  let reported = "active";
  const source = await listen(
    t,
    http.createServer((req, res) => {
      if (req.url === "/api/agents/directory/lookup/lola")
        return res.end(
          JSON.stringify({
            agent: {
              ampAddress: "lola@mini.local",
              name: "lola",
              source: "local",
            },
          }),
        );
      assert.equal(req.url, "/api/sessions/activity?local=true");
      res.end(
        JSON.stringify({
          activity: { lola: { status: reported }, other: { status: "active" } },
        }),
      );
    }),
  );
  for (const [raw, state] of [
    ["active", "working"],
    ["waiting", "waiting"],
    ["idle", "idle"],
    ["missing", "unknown"],
  ]) {
    reported = raw;
    await publishSession(
      origin,
      policy.assignedAgent,
      source,
      controller,
      device.key,
    );
    assert.equal((await read()).state, state);
  }
  await assert.rejects(
    publishSession(
      origin,
      "lola@different.local",
      source,
      controller,
      device.key,
    ),
    /AMP address/,
  );
  // Neither a different signer nor a mismatched claimed owner can publish.
  await assert.rejects(
    publishActivity(
      origin,
      identity(),
      device.key,
      policy.assignedAgent,
      "idle",
    ),
    /403/,
  );
  await assert.rejects(
    publishActivity(origin, controller, device.key, "other@mini.local", "idle"),
    /400/,
  );
  assert.equal((await read()).state, "unknown");
  await call(origin, controller, device.key, "camera.snapshot");
  const frameUrl = screen + "/frame/" + (await read()).frameAt;
  assert.deepEqual(
    Buffer.from(await (await fetch(frameUrl)).arrayBuffer()),
    jpeg,
  );
  assert.equal((await fetch(origin + "/state")).status, 404);
  const wrongHost = await new Promise((resolve, reject) =>
    http
      .get(screen + "/state", { headers: { host: "other.local" } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on("error", reject),
  );
  assert.equal(wrongHost, 403);
  now += 15001;
  assert.equal((await read()).state, "disconnected");
  policy = { ...policy, camera: false };
  assert.equal((await fetch(frameUrl)).status, 404);
  assert.equal((await read()).frameAt, null);
  policy = {
    ...policy,
    assignedAgent: "other@mini.local",
    key: identity().key,
  };
  assert.equal((await read()).agent, "other@mini.local");
  assert.equal((await read()).state, "disconnected");
  policy = null;
  assert.equal((await read()).agent, null);
});
test("old observations cannot overwrite newer ones; media expires or clears on reassignment", () => {
  let now = 0;
  const peer = {
    key: "key",
    assignedAgent: "lola@mini.local",
    camera: true,
    revision: "1",
  };
  const display = new DisplayState(
    () => peer,
    () => now,
  );
  display.update(peer, "waiting", 4);
  assert.equal(display.update(peer, "idle", 3), false);
  assert.equal(display.read().state, "waiting");
  const image = { data: "/9j/2Q==" };
  display.capture(peer, image);
  now += 60001;
  assert.equal(display.read().frameAt, null);
  display.capture(peer, image);
  peer.revision = "2";
  assert.equal(display.read().frameAt, null);
  assert.equal(display.read().state, "disconnected");
  assert.equal(
    sessionState(
      { activity: { other: { status: "active" } } },
      peer.assignedAgent,
    ),
    "unknown",
  );
});
