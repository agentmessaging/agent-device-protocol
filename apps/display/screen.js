const el = (id) => document.getElementById(id);
const body = document.body;

// The signal. The trace math is the approved design; only the levels are real.
const cv = el("scope"),
  ctx = cv.getContext("2d");
const AGENT = "#5aa2ff",
  ICE = "#c9dcf5",
  YOU = "#f2f6fb";
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
let W, H, D;
function size() {
  D = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth;
  H = innerHeight;
  cv.width = W * D;
  cv.height = H * D;
  ctx.setTransform(D, 0, 0, D, 0, 0);
  if (RM) draw(1.3);
}
const lvl = { agent: 0.08, you: 0.03, tight: 0 };
const goal = { agent: 0.08, you: 0.03, tight: 0 };
const STATES = {
  idle: { agent: 0.08, you: 0.03, tight: 0, text: "Here with you" },
  listening: { agent: 0.03, you: 1, tight: 0, text: "Listening to you" },
  thinking: { agent: 0.3, you: 0.03, tight: 1, text: "Thinking" },
  // No word for this: her wave and her own words show it
  speaking: { agent: 1, you: 0.03, tight: 0, text: "" },
};
// The 2xAI Lab signal: interlocked traces that swell in the middle and pinch at the ends
function traces(cy, span, count, t, colors, alpha, width, speed, full = W) {
  for (let k = 0; k < count; k++) {
    ctx.globalAlpha = alpha * (k % 2 ? 0.6 : 1);
    ctx.strokeStyle = colors[k % 2];
    ctx.lineWidth = width;
    ctx.beginPath();
    const n = 260;
    for (let i = 0; i <= n; i++) {
      const u = i / n,
        x = full * u,
        amp = span * Math.sin(Math.PI * u);
      const y =
        cy +
        amp *
          (Math.sin(u * (6 + k * 1.7) * Math.PI + t * speed * (2 + k * 0.6) + k) * 0.6 +
            Math.sin(u * (13 + k * 2.3) * Math.PI - t * speed * 3 + k * 2) * 0.25 * Math.cos(t + k));
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function grid() {
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = "#cfe0f5";
  ctx.lineWidth = 1;
  for (let g = 0; g <= 16; g++) {
    ctx.beginPath();
    ctx.moveTo((W * g) / 16, 0);
    ctx.lineTo((W * g) / 16, H);
    ctx.stroke();
  }
  for (let g = 0; g <= 10; g++) {
    ctx.beginPath();
    ctx.moveTo(0, (H * g) / 10);
    ctx.lineTo(W, (H * g) / 10);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
const FRAME_MS = 30; // about 30 a second: the screen's presence ack shares this thread on slow machines
const EASE = 0.135; // the design's 0.07 per frame at 60, at this rate
function draw(t) {
  ctx.clearRect(0, 0, W, H);
  grid();
  for (const k in lvl) lvl[k] += (goal[k] - lvl[k]) * EASE;
  traces(H * 0.31, H * 0.13 * lvl.agent + 2, 5, t * 0.35, [AGENT, ICE], 0.9, 1.4, 1 + lvl.tight * 2.4);
  traces(H * 0.7, H * 0.08 * lvl.you + 1, 3, t * 0.35 + 9, [YOU, YOU], 0.95, 1.6, 1);
}
const t0 = performance.now();
let raf = 0,
  drawnAt = 0;
function frame(ts) {
  raf = 0;
  if (document.hidden) return;
  if (ts - drawnAt >= FRAME_MS) {
    drawnAt = ts;
    draw((ts - t0) / 1000);
  }
  raf = requestAnimationFrame(frame);
}
function animate() {
  if (!RM && !raf && !document.hidden) raf = requestAnimationFrame(frame);
}
addEventListener("resize", size);
size();

// What the person sees: only paint() writes the line under the name
let controlToken, proposal, lastIndicator;
let last = {}; // the last state from the bridge
let lastAgent;
let who = "your agent";
let problem = "Connecting";
let words = ""; // her words stay until the person starts again
let listening = false; // the person is talking
let thinkingUntil = 0;
let thinkTimer;
let seenTalking = false;
let talkBusy = false;
let talkStarted = 0;
let seenOutput, seenHeard;
const TALK_LIMIT_MS = 19000; // just under the bridge's 20 s: it ended the talk itself and sent it
const THINKING_MS = 60000;
const youWords = el("you-words"),
  status = el("status"),
  talkButton = el("talk"),
  preview = el("preview"),
  picture = el("output-image"),
  gear = el("gear"),
  aside = document.querySelector("aside");

function paint() {
  const state = listening
    ? "listening"
    : last.speaking
      ? "speaking"
      : Date.now() < thinkingUntil
        ? "thinking"
        : "idle";
  body.dataset.state = state;
  const { text, ...levels } = STATES[state];
  Object.assign(goal, levels);
  const showWords = !problem && words && (state === "speaking" || state === "idle");
  status.textContent = problem || (showWords ? words : text);
  status.classList.toggle("words-on", !!showWords);
  talkButton.setAttribute(
    "aria-label",
    (state === "listening" ? "Send to " : "Talk to ") + who,
  );
  if (RM) {
    Object.assign(lvl, levels);
    draw(1.3);
  } else if (state === "listening" || state === "speaking") followLevels();
}
function think(on) {
  clearTimeout(thinkTimer);
  thinkingUntil = on ? Date.now() + THINKING_MS : 0;
  if (on) thinkTimer = setTimeout(paint, THINKING_MS);
}

// Only local letters read as a name when capitalised: "lola" is Lola, "pas-lola" stays as it is
function displayName(agent) {
  const local = agent?.split("@")[0];
  return local && /^[a-z]+$/.test(local)
    ? local[0].toUpperCase() + local.slice(1)
    : local;
}
function setName(name) {
  el("name").textContent = name || "Agent home";
  who = name || "your agent";
  el("type").setAttribute(
    "aria-label",
    body.classList.contains("typing-on") ? "Back to talking" : "Type to " + who,
  );
  el("text").setAttribute("aria-label", "Message to " + who);
  el("text").placeholder = "Write to " + who;
  el("settings-title").textContent = "What " + who + " can use";
}
function renderCamera({ switches = {}, preview: available, indicators = [] }) {
  const on = switches.camera === true;
  const looking = on && indicators.some((kind) => kind !== "microphone");
  const live = on && available === "ready";
  body.classList.toggle("cam-off", !on);
  body.classList.toggle("no-view", !live);
  body.classList.toggle("looking", looking);
  const cam = el("cam");
  cam.setAttribute("aria-pressed", String(!on));
  cam.setAttribute("aria-label", on ? "Turn the camera off" : "Turn the camera on");
  el("eye-note").textContent = !on
    ? "Camera off"
    : looking
      ? who + " is looking"
      : available === "none"
        ? "No camera"
        : available === "disabled"
          ? "Preview off"
          : "Only on this screen";
  // One <img> on one multipart stream: the browser replaces the frames, this script never sees them
  preview.hidden = !live;
  if (live !== preview.hasAttribute("src")) {
    if (live) preview.src = "/preview";
    else preview.removeAttribute("src");
  }
}
function renderProposal(pending) {
  proposal = pending;
  el("proposal").hidden = !pending;
  if (!pending) return;
  const change = pending.change;
  el("proposal-text").textContent =
    change.action === "transfer"
      ? "Transfer this home to " + change.agent + "? Verify the new public key: " + change.key
      : change.action === "revoke"
        ? "Remove the assigned agent from this home?"
        : (change.enabled ? "Allow" : "Revoke") + " camera snapshots for the assigned agent?";
}
function renderSign(indicators) {
  const sign = el("capture-indicator");
  sign.hidden = !indicators.length;
  sign.textContent = indicators
    .map((k) => (k === "microphone" ? "Microphone in use" : "Camera in use"))
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(" · ");
}
let shownName;
function render(state, offline = false) {
  last = state;
  const { agent, indicators = [], indicatorId, switches = {}, output, heard } = state;
  renderSign(indicators);
  lastIndicator = indicatorId;
  controlToken = state.controlToken;
  renderProposal(state.pending);
  if (agent !== lastAgent && !offline) {
    lastAgent = agent;
    words = "";
    youWords.textContent = "";
  }
  // The label comes with the first activity update, a moment after the address
  const name = state.label || displayName(agent);
  if (name !== shownName && !offline) {
    shownName = name;
    setName(name);
  }
  problem = offline ? "Bridge disconnected" : agent ? "" : "Unassigned";
  body.classList.toggle("read-only", !controlToken);
  body.classList.toggle("no-talk", !state.canTalk);
  body.classList.toggle("no-input", !state.canUse);
  talkButton.disabled = switches.microphone !== true;
  for (const sw of document.querySelectorAll(".sw"))
    sw.setAttribute("aria-checked", String(switches[sw.dataset.group] === true));
  renderCamera(state);

  if (state.talking) seenTalking = true;
  else if (seenTalking) {
    // The bridge ended it: the time limit sends, a local stop does not
    seenTalking = false;
    if (listening) {
      listening = false;
      if (Date.now() - talkStarted > TALK_LIMIT_MS) think(true);
    }
  }
  if (state.speaking) think(false);
  if (heard && heard.at !== seenHeard) {
    seenHeard = heard.at;
    if (!listening) youWords.textContent = heard.text;
  }
  if (output && output.at !== seenOutput) {
    seenOutput = output.at;
    // While the person talks she has been cut off: what still arrives belongs to the old reply
    if (!listening) {
      words = output.text;
      think(false);
    }
  }
  if (switches.screen === false) words = "";
  body.classList.toggle("has-picture", !!state.picture);
  picture.hidden = !state.picture;
  const src = state.picture ? "/output/" + state.picture.at : null;
  if (src && picture.getAttribute("src") !== src) picture.src = src;
  if (!src) picture.removeAttribute("src");
  paint();
}
preview.onerror = () => preview.removeAttribute("src");

// A kiosk runs for days. Nothing here may queue or repeat work without a bound (docs/wiki/specs/S002).
const STATE_TIMEOUT_MS = 2000;
const CONTROL_TIMEOUT_MS = 5000;
const LEVELS_MS = 120;
// Safety net while issue #20 is open: a fresh page bounds what any leak can reach. Only when nothing is in use.
const RELOAD_AFTER_MS = 6 * 60 * 60 * 1000;
const loadedAt = Date.now();
let lastBody = null;
let presencePending = false;
let followingLevels = false;
// Levels change every poll, so they stay out of /state and only run while someone is talking
async function followLevels() {
  if (followingLevels) return;
  followingLevels = true;
  let state;
  while (
    !document.hidden &&
    ((state = body.dataset.state) === "listening" || state === "speaking")
  ) {
    try {
      const response = await fetch("/levels", {
        cache: "no-store",
        signal: AbortSignal.timeout(STATE_TIMEOUT_MS),
      });
      if (response.ok) {
        const { you, agent } = await response.json();
        if (state === "speaking") goal.agent = Math.max(STATES.idle.agent, agent);
        else goal.you = Math.max(STATES.idle.you, you);
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, LEVELS_MS));
  }
  followingLevels = false;
}
function acknowledgePresence() {
  if (presencePending) return;
  presencePending = true;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      control("/presence", {
        visible: document.visibilityState === "visible",
        indicatorId: lastIndicator,
      })
        .catch(() => {})
        .finally(() => {
          presencePending = false;
        });
    }),
  );
}
function reloadIfIdle() {
  if (
    Date.now() - loadedAt > RELOAD_AFTER_MS &&
    lastBody !== "offline" &&
    !listening &&
    !last.live?.length &&
    !last.indicators?.length &&
    !last.pending &&
    !el("text").value
  )
    location.reload();
}
async function poll() {
  try {
    const response = await fetch("/state", {
      cache: "no-store",
      signal: AbortSignal.timeout(STATE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error();
    const text = await response.text();
    // Most polls change nothing: writing the same text still costs a layout, five times a second, all day
    if (text !== lastBody) {
      lastBody = text;
      render(JSON.parse(text));
    }
    if (controlToken && document.visibilityState === "visible") acknowledgePresence();
    reloadIfIdle();
  } catch {
    if (lastBody !== "offline") {
      lastBody = "offline";
      render({ agent: null }, true);
    }
  }
  setTimeout(poll, 200);
}

async function control(path, data) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Display-Token": controlToken,
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Could not change this. Try again.");
  return response;
}

// Tap to talk, tap to send. A button gives the space bar for free when it has focus.
talkButton.onclick = async () => {
  if (talkBusy) return;
  talkBusy = true;
  try {
    if (listening) await sendTalk();
    else await startTalk();
  } finally {
    talkBusy = false;
  }
};
async function startTalk() {
  listening = true;
  talkStarted = Date.now();
  think(false);
  words = "";
  youWords.textContent = "";
  paint();
  try {
    await control("/talk", { action: "start" });
  } catch {
    listening = false;
    youWords.textContent = "Could not use the microphone. Check that it is allowed.";
    paint();
  }
}
async function sendTalk() {
  listening = false;
  seenTalking = false;
  think(true);
  paint();
  try {
    const response = await control("/talk", { action: "stop" });
    // Under half a second was a slip of the finger, and nothing went
    if (!(await response.json()).sent) {
      think(false);
      paint();
    }
  } catch {
    think(false);
    youWords.textContent = "Could not send. Check the connection and try again.";
    paint();
  }
}

function typing(on) {
  body.classList.toggle("typing-on", on);
  const button = el("type");
  button.setAttribute("aria-pressed", String(on));
  button.setAttribute("aria-label", on ? "Back to talking" : "Type to " + who);
  if (on) el("text").focus();
}
el("type").onclick = () => typing(!body.classList.contains("typing-on"));
el("typing").onsubmit = async (event) => {
  event.preventDefault();
  const text = el("text").value.trim();
  if (!text) return;
  el("text").value = "";
  typing(false);
  youWords.textContent = text;
  words = "";
  think(true);
  paint();
  try {
    await control("/input", { text });
  } catch {
    think(false);
    el("text").value = text;
    typing(true);
    youWords.textContent = "Could not send. Check the connection and try again.";
    paint();
  }
};

async function grant(group, on) {
  try {
    await control("/grant", { group, on });
    el("settings-error").textContent = "";
  } catch (error) {
    el("settings-error").textContent = error.message;
  }
}
for (const sw of document.querySelectorAll(".sw"))
  sw.onclick = () => grant(sw.dataset.group, sw.getAttribute("aria-checked") !== "true");
el("cam").onclick = () => grant("camera", body.classList.contains("cam-off"));
el("stop").onclick = async () => {
  try {
    await control("/stop", {});
    el("settings-error").textContent = "";
    think(false);
    paint();
  } catch (error) {
    el("settings-error").textContent = error.message;
  }
};
function settings(on) {
  if (on === body.classList.contains("settings")) return;
  body.classList.toggle("settings", on);
  gear.setAttribute("aria-expanded", String(on));
  aside.inert = !on;
  (on ? el("close") : gear).focus();
}
gear.onclick = () => settings(true);
el("close").onclick = () => settings(false);
addEventListener("keydown", (event) => {
  if (event.key === "Escape") settings(false);
});

for (const [id, approve] of [
  ["approve-change", true],
  ["reject-change", false],
])
  el(id).onclick = async () => {
    if (!proposal) return;
    try {
      await control("/decision", { id: proposal.id, approve });
      el("proposal-error").textContent = "";
    } catch (error) {
      el("proposal-error").textContent = error.message;
    }
  };

document.addEventListener("visibilitychange", () => {
  animate();
  if (!document.hidden) paint();
  if (controlToken)
    control("/presence", {
      visible: document.visibilityState === "visible",
      indicatorId: lastIndicator,
    }).catch(() => {});
});

setName();
paint();
animate();
poll();
