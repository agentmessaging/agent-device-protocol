let controlToken, proposal;
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
    controlToken: token,
    pending,
  },
  offline = false,
) {
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
