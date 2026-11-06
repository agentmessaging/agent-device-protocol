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
    indicators = [],
    indicatorId,
  },
  offline = false,
) {
  el("device-mode").textContent =
    active === true ? "Active device" : active === false ? "Idle device" : "";
  el("use-device").hidden = !canUse;
  el("device-input").hidden = !canUse;
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
async function poll() {
  try {
    const response = await fetch("/state", {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error();
    render(await response.json());
    if (controlToken && document.visibilityState === "visible") {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          control("/presence", {
            visible: document.visibilityState === "visible",
            indicatorId: lastIndicator,
          }).catch(() => {});
        }),
      );
    }
  } catch {
    render(
      { agent: null, state: "disconnected", camera: false, frameAt: null },
      true,
    );
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
