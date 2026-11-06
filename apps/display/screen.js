let controlToken, proposal, lastIndicator;
const el = (id) => document.getElementById(id);
const labels = {
  working: "Working",
  waiting: "Waiting for you",
  idle: "Idle",
  unknown: "Activity unavailable",
  disconnected: "Disconnected",
};
const panel = el("pip"),
  toggle = el("expand"),
  img = el("frame");
toggle.onclick = () => {
  const expanded = panel.classList.toggle("expanded");
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.textContent = expanded ? "Reduce" : "Expand";
};
function render(
  {
    agent,
    state,
    camera,
    frameAt,
    live = [],
    mediaConsent = {},
    outputConsent = {},
    output,
    controlToken: token,
    pending,
    active,
    canUse,
    canTalk,
    indicators = [],
    indicatorId,
  },
  offline = false,
) {
  el("device-mode").textContent =
    active === true ? "Active device" : active === false ? "Idle device" : "";
  el("use-device").hidden = !canUse;
  el("device-input").hidden = !canUse;
  el("talk").hidden = !canTalk || mediaConsent.microphone !== true;
  const sign = el("capture-indicator");
  sign.hidden = !indicators.length;
  sign.textContent = indicators
    .map((k) => (k === "microphone" ? "Microphone in use" : "Camera in use"))
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(" · ");
  lastIndicator = indicatorId;
  controlToken = token;
  proposal = pending;
  el("proposal").hidden = !pending;
  if (pending) {
    const change = pending.change;
    el("proposal-text").textContent =
      change.action === "transfer"
        ? "Transfer this home to " +
          change.agent +
          "? Verify the new public key: " +
          change.key
        : change.action === "revoke"
          ? "Remove the assigned agent from this home?"
          : (change.enabled ? "Allow" : "Revoke") +
            " camera snapshots for the assigned agent?";
  }
  el("consent").hidden = !token;
  for (const input of document.querySelectorAll("[data-media]"))
    input.checked = mediaConsent[input.dataset.media] === true;
  for (const input of document.querySelectorAll("[data-output]"))
    input.checked = outputConsent[input.dataset.output] === true;
  el("agent-output").hidden = !output;
  el("output-text").textContent = output?.text ?? "";
  const outputImage = el("output-image");
  outputImage.hidden = !output?.data;
  const outputSrc = output?.data ? "/output/" + output.at : null;
  if (outputSrc && outputImage.getAttribute("src") !== outputSrc)
    outputImage.src = outputSrc;
  if (!outputSrc) outputImage.removeAttribute("src");
  el("media-status").textContent = live.length
    ? live
        .map((k) =>
          k === "video"
            ? "Camera live"
            : k === "microphone"
              ? "Mic live"
              : "Speaker playing",
        )
        .join(" · ")
    : "";
  document.body.dataset.state = state;
  el("name").textContent = agent?.split("@")[0] || "Agent home";
  el("address").textContent = agent || "";
  el("status").textContent = offline
    ? "Bridge disconnected"
    : agent
      ? labels[state]
      : "Unassigned";
  const src = frameAt === null ? null : "/frame/" + frameAt;
  if (src !== img.getAttribute("src")) {
    img.hidden = true;
    if (src) img.src = src;
    else img.removeAttribute("src");
  }
  el("empty").textContent = src
    ? ""
    : camera
      ? "No recent capture"
      : "Camera off";
  el("caption").textContent = src
    ? (live.includes("video") ? "Camera live · " : "Snapshot · ") +
      new Date(frameAt).toLocaleTimeString()
    : "Last camera snapshot";
}
img.onload = () => {
  img.hidden = false;
};
img.onerror = () => {
  img.hidden = true;
  el("empty").textContent = "Frame unavailable";
};
// A kiosk runs for days. Nothing here may queue or repeat work without a bound (docs/wiki/specs/S002).
const STATE_TIMEOUT_MS = 2000;
const CONTROL_TIMEOUT_MS = 5000;
// Safety net while issue #20 is open: a fresh page bounds what any leak can reach. Only when nothing is in use.
const RELOAD_AFTER_MS = 6 * 60 * 60 * 1000;
const loadedAt = Date.now();
let lastState = null;
let lastBody = null;
let presencePending = false;
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
    lastState &&
    !lastState.live?.length &&
    !lastState.indicators?.length &&
    !lastState.pending &&
    !el("input-text").value
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
    const body = await response.text();
    // Most polls change nothing: writing the same text still costs a layout, five times a second, all day
    if (body !== lastBody) {
      lastBody = body;
      lastState = JSON.parse(body);
      render(lastState);
    }
    if (controlToken && document.visibilityState === "visible")
      acknowledgePresence();
    reloadIfIdle();
  } catch {
    if (lastBody !== "offline") {
      lastBody = "offline";
      render(
        { agent: null, state: "disconnected", camera: false, frameAt: null },
        true,
      );
    }
  }
  setTimeout(poll, 200);
}
poll();

async function control(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Display-Token": controlToken,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Could not update media permission");
}
for (const input of document.querySelectorAll("[data-media]"))
  input.onchange = async () => {
    try {
      await control("/consent", { [input.dataset.media]: input.checked });
    } catch (error) {
      el("media-status").textContent = error.message;
    }
  };
el("stop-media").onclick = async () => {
  try {
    await control("/stop", {});
  } catch (error) {
    el("media-status").textContent = error.message;
  }
};

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

el("use-device").onclick = async () => {
  try {
    await control("/used", {});
  } catch (error) {
    el("media-status").textContent = error.message;
  }
};

// Hold to talk: a pointer or the space bar. Releasing anywhere ends it, so it cannot stay on.
let talking = false;
async function talk(action) {
  if ((action === "start") === talking) return;
  talking = action === "start";
  el("talk").textContent = talking ? "Listening… release to send" : "Hold to talk";
  try {
    await control("/talk", { action });
    if (!talking) el("input-status").textContent = "Sent to your agent";
  } catch {
    talking = false;
    el("talk").textContent = "Hold to talk";
    el("input-status").textContent =
      "Could not use the microphone. Check that it is allowed.";
  }
}
el("talk").onpointerdown = () => talk("start");
window.addEventListener("pointerup", () => talk("stop"));
window.addEventListener("pointercancel", () => talk("stop"));
window.addEventListener("blur", () => talk("stop"));
el("talk").onkeydown = (event) => {
  if (event.code === "Space" && !event.repeat) talk("start");
};
el("talk").onkeyup = (event) => {
  if (event.code === "Space") talk("stop");
};

el("device-input").onsubmit = async (event) => {
  event.preventDefault();
  try {
    await control("/input", { text: el("input-text").value });
    el("input-text").value = "";
    el("input-status").textContent = "Sent to your agent";
  } catch {
    el("input-status").textContent =
      "Could not send. Check the connection and try again.";
  }
};

document.addEventListener("visibilitychange", () => {
  if (controlToken)
    control("/presence", {
      visible: document.visibilityState === "visible",
      indicatorId: lastIndicator,
    }).catch(() => {});
});

for (const input of document.querySelectorAll("[data-output]"))
  input.onchange = async () => {
    try {
      await control("/outputs", { [input.dataset.output]: input.checked });
    } catch (error) {
      el("media-status").textContent = error.message;
    }
  };
