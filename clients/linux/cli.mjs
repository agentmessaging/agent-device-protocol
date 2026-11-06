import { join } from "node:path";
import { CustomCapabilities } from "./custom.mjs";
import { once } from "node:events";
import { DeviceConnection, boundedJson } from "../../packages/sdk/reverse.mjs";
import { PushToTalk } from "./talk.mjs";
import {
  init,
  dir,
  setOutputConsent,
  setCustomConsent,
  pair,
  self,
  peer,
  setMediaConsent,
  readLocal,
  writeLocal,
  applyLocalChange,
} from "../../packages/sdk/state.mjs";
import { agentAddress, localAddress } from "@ai-maestro/device-sdk";
import { DisplayState, displayServer } from "../../apps/display/server.mjs";
import { Proposals } from "./proposals.mjs";
import { MediaManager } from "./media.mjs";
import { bridge } from "./server.mjs";
const [action, arg, option, ...extra] = process.argv.slice(2);
if (action === "init" && !arg) init();
else if (
  action === "assign" &&
  (extra.length === 0 || (extra.length === 1 && extra[0] === "--camera"))
) {
  pair(option, {
    assignedAgent: agentAddress(arg),
    camera: extra.length === 1,
  });
} else if (
  action === "consent" &&
  ["video", "microphone", "speaker"].includes(arg) &&
  ["on", "off"].includes(option) &&
  !extra.length
) {
  setMediaConsent({ [arg]: option === "on" });
  console.log(arg + " " + option);
} else if (
  action === "grant" &&
  arg &&
  ["on", "off"].includes(option) &&
  !extra.length
) {
  if (arg.startsWith("custom.")) setCustomConsent(arg, option === "on");
  else setOutputConsent({ [arg]: option === "on" });
  console.log(arg + " " + option);
} else if (action === "assignment" && !arg) {
  const policy = peer();
  console.log(
    JSON.stringify(
      {
        ...policy,
        assignedAgent: policy.assignedAgent
          ? agentAddress(policy.assignedAgent)
          : null,
      },
      null,
      2,
    ),
  );
} else if (["serve", "connect"].includes(action) && !option) {
  const host = action === "connect" ? "127.0.0.1" : arg || "127.0.0.1";
  if (!localAddress(host))
    throw new Error("Bind to a loopback or a local Tailscale IPv4 address");
  try {
    if (peer().assignedAgent) agentAddress(peer().assignedAgent);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const display = new DisplayState(peer);
  const proposals = new Proposals(
    peer,
    () => readLocal("proposal.json"),
    (p) => writeLocal("proposal.json", p),
    applyLocalChange,
  );
  const media = new MediaManager(peer, display);
  let connection;
  const talk = new PushToTalk({
    getPeer: peer,
    display,
    send: (audio) => connection.audio(audio),
  });
  // serve can also connect out, for device input: `connect` alone has no live media
  const controllerOrigin = action === "connect" ? arg : process.env.ADP_CONTROLLER;
  const screen = displayServer(display, {
    setConsent: setMediaConsent,
    setOutputs: setOutputConsent,
    stopAll: () => {
      talk.cancel();
      media.stopAll();
    },
    proposals,
    ...(controllerOrigin
      ? {
          used: () => connection.used(),
          input: (text) => connection.input(text),
          talk: (action) => (action === "start" ? talk.start() : talk.stop()),
          afterDecision: (receipt) =>
            connection.finishProposal(receipt).catch(() => {}),
        }
      : {}),
  });
  screen.listen(23111, "127.0.0.1", () =>
    console.log("Display: http://127.0.0.1:23111"),
  );
  const server = bridge(
    self(),
    peer,
    undefined,
    display,
    action === "connect" ? undefined : media,
    proposals,
    new CustomCapabilities(join(dir, "capabilities")),
  );
  server.listen(action === "connect" ? 0 : 23110, host);
  await once(server, "listening");
  if (controllerOrigin) {
    const local = action === "connect" ? "127.0.0.1" : host;
    connection = new DeviceConnection({
      origin: controllerOrigin,
      identity: self(),
      getPeer: peer,
      adapter: async (method, body, signal) => {
        const response = await fetch(
          "http://" + local + ":" + server.address().port + "/v1/" + method,
          {
            signal,
            method: method === "challenge" ? "GET" : "POST",
            ...(body ? { body: JSON.stringify(body) } : {}),
          },
        );
        return { status: response.status, body: await boundedJson(response) };
      },
    });
    connection.on("connected", () =>
      console.log("Connected to assigned controller"),
    );
    connection.on("disconnected", () => console.log("Controller disconnected"));
    connection.on("stopped", (reason) =>
      console.log("Stopped connecting to the controller: " + reason),
    );
  }
  if (action !== "connect") console.log("Device listening on http://" + host + ":23110");
  const stop = async () => {
    media.stopAll();
    await connection?.stop();
    screen.close();
    screen.closeAllConnections();
    server.close();
    server.closeAllConnections();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
} else
  throw new Error(
    "Usage: init | consent video|microphone|speaker on|off | assignment | assign AMP_ADDRESS AGENT_PUBLIC_KEY [--camera] | serve [TAILSCALE_IP] | connect CONTROLLER_ORIGIN",
  );
