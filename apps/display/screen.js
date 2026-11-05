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
function render({ agent, state, camera, frameAt }, offline = false) {
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
    ? "Snapshot · " + new Date(frameAt).toLocaleTimeString()
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
  setTimeout(poll, 1000);
}
poll();
