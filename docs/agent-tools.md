# Agent tools, live media and lifecycle

The reference controller exposes eleven fixed MCP tools. AI Maestro can instead embed [the host-wide Controller SDK](controller-sdk.md) directly. It can run under the normal shared system user. Optional account isolation and the protected Linux broker are deployment choices. The device bridge remains on the MacBook. Update both checkouts and restart the bridge before using media.

## Configure the agent tools

In the controller's existing paired environment on Mini Lola, run from the repository checkout:

```sh
git pull --ff-only
npm ci --ignore-scripts
node apps/controller/cli.mjs add macbook "$DEVICE_URL"
node apps/controller/cli.mjs install-mcp /absolute/path/to/lolas/workspace
```

Use the same ADP_HOME and Node runtime used for pairing. The add command performs signed discovery and binds the stored URL and device key to the assigned AMP address. Up to 16 devices may be registered to that one agent. install-mcp merges a named server into the workspace's .mcp.json and preserves existing servers. It refuses to replace a different signer configuration.

Reopen Lola's Claude Code session in that workspace and approve the local MCP server. Other MCP clients can use the generated server command, args and environment in their own configuration. In the agent chat, ask “Check my MacBook, take a photo, and describe what is visible.” device_snapshot returns an image content block directly to the agent. The agent-devices skill in the companion Maestro plugin change routes requests to these tools.

| Tool | Result |
| --- | --- |
| device_list | Verified owned device inventory and capability schemas |
| device_jump | Select an owned device, or `none` |
| device_health | Signed health report |
| device_snapshot | JPEG image |
| device_camera_live | Live PiP during a 1–30 second session, then the latest JPEG |
| device_microphone | WAV audio from a 1–10 second session |
| device_speaker | Plays supplied mono 16 kHz signed little-endian 16-bit PCM, up to 10 seconds |
| device_show_text / device_show_image | Locally permitted plain text or bounded JPEG/PNG |
| device_say | Locally permitted speech through espeak-ng |
| device_custom | Only owner-installed custom operations and declared arguments |

Use `device_jump` or `node apps/controller/cli.mjs jump macbook` to select the device before sensors, media or output. Inventory and health remain available on idle devices. `list` works without a key or devices. Existing peer.json profiles migrate when a known URL is first discovered; registered devices are stored by key, with one atomic active selection.

Keep the MacBook screen visible: camera and microphone are not advertised until a local indicator is available. On the MacBook's http://127.0.0.1:23111 screen, the gear opens four switches: Camera (`camera` and `video`), Microphone (`microphone`), Speaker (`speaker`, `speaker.say`, `speaker.play`) and Screen (`display.text`, `display.image`). A switch reads on only when all of its grants are on. Enable what you want, then ask the agent to start a session. The screen shows a gold in-use sign, and a gold ring with "NAME is looking" while the agent uses the camera. Stop everything now turns off every grant, including still pictures, and stops all that runs. Changing any grant closes current sessions.

Linux media uses ffmpeg, V4L2 /dev/video0 and the desktop user's PulseAudio-compatible service (including pipewire-pulse). Ensure `ffmpeg` and `pipewire-pulse` are installed on Omarchy. An unavailable device or unsupported camera mode produces a tool error. The browser receives the frames actually emitted to the controller, with capture time. Microphone audio is transported as PCM and returned as WAV. Speech recognition and text-to-speech must be supplied by the agent runtime. Live sessions have bounded duration, frame size and buffers and stop on client disconnect, local revoke or ownership change. The screen shows the person their own picture with a four-frames-a-second ffmpeg preview, on loopback only, which pauses while a snapshot or video session has `/dev/video0`. Set `ADP_PREVIEW=off` on a slow device to turn the preview off; snapshots still work.

## Background inventory and AMP notices

Run `node apps/controller/cli.mjs monitor` in the controller environment. It refreshes signed inventory/health, publishes Maestro activity and sends online, offline and revoked notifications through the installed amp-send executable. The monitor records delivered state to suppress repeated notices across restarts and retries delivery failures. AMP must already be configured for the sending identity. The device runs no AMP credentials.

For a persistent Linux controller service, copy apps/controller/ai-maestro-device-monitor.service to ~/.config/systemd/user and create ~/.config/ai-maestro-device/controller.env. Set ADP_NODE to the absolute Node binary, ADP_REPO to this checkout, ADP_HOME if customized, MAESTRO_URL to the agent's Maestro origin, and PATH to include the installed amp-send command. Then run `systemctl --user daemon-reload && systemctl --user enable --now ai-maestro-device-monitor`. Enable linger for unattended use as in the Omarchy runbook. Run one monitor per controller profile. A monitor.lock directory prevents concurrent writers. After an unclean shutdown it automatically recovers a lock whose recorded process no longer exists.

An offline transition requires three failed health polls. Probes are bounded and repeated; a successful poll resets the failure count. This is host-observed liveness. A powered-off device cannot send a notification itself.

## Optional reference dashboard adapter (on hold for AI Maestro)

The earlier companion Maestro change is on hold. AI Maestro will implement [the controller role](../protocol/controller.md) directly in its server, without this shared folder or a monitor per agent. For other reference integrations, the adapter adds /agent-homes and /api/agent-homes in both full and headless modes. Set the same ADP_DASHBOARD_DIR on Maestro and the controller monitor. Its status subdirectory contains public device observations. Its requests subdirectory carries operator requests. Grant the monitor write access to status and read access to requests, and Maestro read access to status and write access to requests. Keep the parent directory controlled by the operator. It contains no private signing keys.

Transfer, camera and unassignment requests remain pending until someone approves on the physical device's display. A request expires after five minutes. The device persists the latest signed approval receipt, including after revocation, so the previous controller can confirm completion without retaining hardware access. A new controller needs its own device pairing and inventory configuration. Every accepted ownership transfer resets hardware grants.

## Optional hardening: protected Linux signer

The broker authorizes Linux user IDs through SO_PEERCRED. Run Lola in a dedicated OS runtime account. Other agents can share the host but must have different UIDs from Lola. An unrestricted process with Lola's UID has Lola's authority. This mechanism requires Linux; On macOS, separate accounts are also optional; plain shared-user operation remains supported.

Deploy a root-owned, non-user-writable copy of this repository under /opt/ai-maestro-device, with npm workspace dependencies installed. The runtime, broker code and all imported code must have root-owned, non-writable ancestors. The broker checks these conditions on startup. Use a root-owned Node binary, such as /usr/bin/node. Keep each signing profile in a root-only directory under /var/lib/ai-maestro-device/<agent>.

Initialize a fresh identity and register its device while acting as the broker administrator. Print its public key with the existing init command, assign that public key on the MacBook, pair the device public key into the root-only profile, and use add to populate that profile's controller.json. The identity.json and controller.json files must be root-owned mode 0600 and their directory mode 0700.

Create /etc/ai-maestro-device/broker.json mode 0600, owned by root, using the numeric UID from `id -u lola-runtime`:

```json
{
  "agents": {
    "REPLACE_WITH_NUMERIC_UID": {
      "agent": "REPLACE_WITH_FULL_AMP_ADDRESS",
      "state": "/var/lib/ai-maestro-device/lola"
    }
  }
}
```

Create the root-owned /etc/ai-maestro-device/broker.env with ADP_REPO=/opt/ai-maestro-device and ADP_NODE=/usr/bin/node. Install services/broker/ai-maestro-device-broker.service as a system unit, then `sudo systemctl daemon-reload && sudo systemctl enable --now ai-maestro-device-broker`.

From Lola's runtime account, register the MCP server with the broker socket:

```sh
export ADP_BROKER_SOCKET=/run/ai-maestro-device/broker.sock
node apps/controller/cli.mjs install-mcp /absolute/path/to/lolas/workspace
```

The broker owns the keys. The MCP subprocess forwards only fixed tool names and arguments through the Unix socket. Root UID and unlisted UIDs are rejected. There are four bounded concurrent worker slots; disconnect kills the worker and closes any media connection. Do not copy a broker identity back to a shared agent account. Rotate previously shared keys when adopting this mode.

For monitor/dashboard operation with protected profiles, run the monitor as an administrator-managed service with access to the root-only profile and a separately configured AMP sender environment. The broker service itself is solely a signer/tool endpoint. It does not start or impersonate agent runtimes.
