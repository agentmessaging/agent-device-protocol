# Pair the Omarchy MacBook with Mini Lola

The MacBook serves its local hardware. Mini Lola runs the controller alongside Maestro. Both hosts need an authenticated GitHub account with read access to this private repository. Use the same desktop user each time. Run the bridge without sudo.

## 1. Install on the MacBook

On the existing x86-64 Omarchy / Arch installation:

```sh
sudo pacman -Syu --needed nodejs npm git tailscale ffmpeg v4l-utils
sudo systemctl enable --now tailscaled
tailscale status
```

If the MacBook is signed out, run `sudo tailscale up` and follow its login prompt. On both machines, confirm Tailscale lists the intended peer. Restrict the tailnet policy to allow Mini Lola to reach only the MacBook on TCP port 23110 for this service. Review any broader rules already granting access. Do not forward the port on the router. The app enforces pinned keys separately.

## 2. Get the code on both machines

On **each** machine, from the location where you keep repositories:

```sh
git clone https://github.com/23blocks-OS/ai-maestro-device-protocol.git
cd ai-maestro-device-protocol
node --version
npm ci --ignore-scripts
npm test
```

Mini Lola needs Node.js 22 or newer and npm on its PATH. If Git asks for credentials, authenticate with a GitHub account that can access the organization repo. The workspace has zero third-party runtime dependencies.

## 3. Exchange two public keys

On **Omarchy**:

```sh
node clients/linux/cli.mjs init
tailscale ip -4
```

On **Mini Lola**, launch the chosen agent and its controller under a dedicated OS account or an isolated container. Only that agent may read its key or call its signer. Maestro agents running unrestricted as the same OS user can impersonate each other. Separate directories alone do not isolate them. For an upgrade from a shared controller, initialize a fresh key inside the isolated account and stop the old bridge before replacing it.

From the chosen agent's isolated environment:

```sh
node apps/controller/cli.mjs init
```

Each init prints the same public key on repeat runs. Compare the keys using the physical consoles or another trusted channel. Replace the uppercase placeholders below. Use the MacBook's tailnet IP, not Mini Lola's.

On **Omarchy**, substitute the agent's full Maestro AMP address and the public key printed in its isolated account. This local assignment replaces any previous one. Repeat it with a fresh key when changing agents. Legacy key-only device pairings require a new assignment.

```sh
node clients/linux/cli.mjs assign AGENT_AMP_ADDRESS AGENT_PUBLIC_KEY
node clients/linux/cli.mjs assignment
node clients/linux/cli.mjs serve "$(tailscale ip -4)"
```

Keep this terminal open. On **Mini Lola**:

```sh
node apps/controller/cli.mjs pair DEVICE_PUBLIC_KEY
export DEVICE_URL='http://MACBOOK_TAILSCALE_IPV4:23110'
node apps/controller/cli.mjs discover "$DEVICE_URL"
node apps/controller/cli.mjs invoke "$DEVICE_URL" device.health
```

Expect a signed registration listing `device.health`, followed by a result containing `"status": "ok"` and `"platform": "linux"`. If discovery fails, check `tailscale ping MACBOOK_TAILSCALE_IPV4`, the tailnet policy, and the listening address printed by the bridge.

### Transfer the MacBook to another agent

Initialize a fresh controller identity inside the next agent's isolated environment and verify its public key. On the MacBook, run:

```sh
node clients/linux/cli.mjs assign NEW_AGENT_AMP_ADDRESS NEW_AGENT_PUBLIC_KEY
node clients/linux/cli.mjs assignment
```

In the new controller environment run `node apps/controller/cli.mjs pair DEVICE_PUBLIC_KEY`, then discover and check health as above. The old key loses access immediately. Camera permission starts off. If a snapshot was in progress, the new agent may briefly receive HTTP 409; retry when capture ends. These ownership rules apply to every device and its attached capabilities.

## 4. Test the built-in camera locally, then grant permission

In a second terminal on the **MacBook**, from the repository directory:

```sh
v4l2-ctl --list-devices
v4l2-ctl --device=/dev/video0 --list-formats-ext
ffmpeg -nostdin -loglevel error -f video4linux2 -i /dev/video0 -frames:v 1 -n /tmp/adp-local-test.jpg
```

If the last command succeeds, inspect the photo and remove that temporary file. If no video node appears, check `lsusb` and `journalctl -k -b` for the detected camera and driver. If access is denied, check desktop-session device permissions with `getfacl /dev/video0`. Close other camera apps if the device is busy. On this MVP the adapter uses /dev/video0. Health works independently of the camera.

Grant standing camera access to this one controller:

```sh
node clients/linux/cli.mjs assign AGENT_AMP_ADDRESS AGENT_PUBLIC_KEY --camera
```

On **Mini Lola**:

```sh
node apps/controller/cli.mjs discover "$DEVICE_URL"
node apps/controller/cli.mjs invoke "$DEVICE_URL" camera.snapshot macbook-test.jpg
```

Expect `camera.snapshot` in discovery and a new JPEG file. Use a fresh filename for each capture. To withdraw camera permission, repeat the MacBook assign command without `--camera`. To revoke all future commands immediately, delete `${ADP_HOME:-$HOME/.config/ai-maestro-device}/peer.json` on the MacBook. An operation already authorized may finish. Stop the bridge with Ctrl-C.

## 5. Optional user service

After the foreground health check passes, stop the foreground bridge. From the same checkout on the MacBook:

```sh
mkdir -p ~/.config/systemd/user
cp clients/linux/ai-maestro-device.service ~/.config/systemd/user/
mkdir -p ~/.config/ai-maestro-device
printf 'ADP_REPO="%s"\nADP_BIND=%s\n' "$PWD" "$(tailscale ip -4)" > ~/.config/ai-maestro-device/service.env
systemctl --user daemon-reload
systemctl --user enable --now ai-maestro-device
journalctl --user -u ai-maestro-device -n 30
```

The unit assumes Arch's /usr/bin/node and runs in the user's login session. Keep the checkout at the configured path. Use `systemctl --user disable --now ai-maestro-device` to stop and disable it. Update service.env if the IP or checkout moves.

## 6. Optional AMP notification

On Mini Lola, in the configured sending agent's AMP environment, with Maestro's `amp-send` installed and authenticated, run:

```sh
node apps/controller/cli.mjs announce "$DEVICE_URL"
```

This performs fresh signed discovery and sends one inventory notification to the assigned agent named in the signed registration. To invoke from an agent, expose the controller's fixed operations to that trusted agent or call the SDK from its local tool. The controller identity belongs to the local OS user. Anyone who can read its private key has the same grants.

## 7. Show the assigned agent and its camera picture on the MacBook

**Update an already paired device.** In the existing checkout on both machines, run `git pull --ff-only && npm ci --ignore-scripts`. Keep the same OS account and ADP_HOME on each machine. Existing keys and assignments continue to work.

On the MacBook, restart the installed user service:

```sh
systemctl --user restart ai-maestro-device
```

If you started the bridge in the foreground, stop that process instead and relaunch `node clients/linux/cli.mjs serve "$(tailscale ip -4)"`. The same bridge now serves the read-only display separately on loopback. Open **http://127.0.0.1:23111** in the MacBook browser. For full screen on Omarchy, use `chromium --kiosk http://127.0.0.1:23111`.

On Mini Lola, in the assigned agent's isolated controller environment, set DEVICE_URL to the same MacBook URL used for the health test and start:

```sh
node apps/controller/cli.mjs watch "$DEVICE_URL"
```

Keep the publisher running. It reads the assigned AMP address from signed discovery, verifies its full address against Maestro's local directory, and reads that session's activity every three seconds from http://127.0.0.1:23000. For a separate controller environment, set MAESTRO_URL to the trusted numeric Tailscale HTTP origin of the agent's Maestro host. Use the canonical AMP address reported by that host's directory. This version matches the session name to the part before @. The optional argument after DEVICE_URL asserts the expected full address.

Start a task in the agent's normal Maestro session. The orb and caption follow the reported state (working, idle, waiting for you). A missing session shows “Activity unavailable.” If the source, publisher, or network stops reporting, the display shows “Disconnected” after 15 seconds. The display can run without camera permission.

**Test picture in picture.** With camera permission enabled as in section 4, invoke `camera.snapshot` from Mini Lola. The inset on the MacBook shows the same JPEG returned by the bridge and its capture time. Expand the inset for a larger view. It mirrors snapshots from the bridge only. No extra browser camera permission is needed. The last frame expires after one minute, or clears earlier on camera revocation, unassignment or transfer. Polling the screen never starts a camera capture. Continuous video, voice levels and transcript rendering are outside this version.

If the orb stays disconnected, look at the publisher's terminal first. A directory mismatch means the source is on a different Maestro host, or the MacBook assignment uses a different address. Inspect `node clients/linux/cli.mjs assignment` on the MacBook. Registration after upgrading should advertise `events: ["activity"]`. The screen port is local to the MacBook; only the signed bridge port 23110 needs tailnet access.
