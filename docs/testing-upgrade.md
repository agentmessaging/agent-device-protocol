# Test the current protocol changes

The completed protocol implementation is on main after PRs #9, #17 and #18. Updating the repository does not deploy it to your MacBook automatically. In each existing device-protocol checkout, with the same Node 22+ runtime and ADP_HOME used for pairing:

```sh
git fetch origin
git switch main
git pull --ff-only
npm ci --ignore-scripts
npm run typecheck
npm test
```

Do not initialize new identities or reassign an already paired MacBook just to update the code. Existing pins and grants remain; new media/output grants default off. The old `peer.json` controller pin is migrated when its device URL is first discovered. A controller with no devices can list an empty inventory without a key.

## Existing HTTP setup

On Omarchy, restart the installed user service and open its display:

```sh
systemctl --user restart ai-maestro-device
chromium --app=http://127.0.0.1:23111
```

If using a terminal instead of a service, stop the old bridge and run `node clients/linux/cli.mjs serve TAILSCALE_IP`. Keep the screen visible. The device does not advertise camera/microphone capture without the local indicator. Enable the desired live media/output controls on that screen; snapshot permission remains the local camera grant.

On the controller host, use the actual numeric tailnet URL:

```sh
node apps/controller/cli.mjs add macbook http://MACBOOK_TAILSCALE_IP:23110
node apps/controller/cli.mjs list
node apps/controller/cli.mjs jump macbook
node apps/controller/cli.mjs invoke macbook device.health
node apps/controller/cli.mjs invoke macbook camera.snapshot macbook-test.jpg
```

`MACBOOK_TAILSCALE_IP` is a placeholder to replace. An output JPEG must be a new filename. If a second device is paired, add it with its own public key: `add kitchen http://SECOND_TAILSCALE_IP:23110 SECOND_DEVICE_PUBLIC_KEY`; then `jump kitchen` or `jump none`. Switching does not wait for an offline old device. Idle devices still answer health but cannot supply sensors/media/output through the controller.

For standalone agent testing, install the reference MCP server using `install-mcp /absolute/path/to/agent/workspace`, reopen the agent session and approve that local server. Ask the agent to list devices, activate the MacBook and take a photo. AI Maestro's direct host-server integration uses [controller-sdk.md](controller-sdk.md); do not install the held shared-folder dashboard PR as the intended integration.

## Device-initiated connection

This mode carries snapshots, typed operations and text input. Keep HTTP mode for live camera/microphone streams. Stop the old bridge before switching modes.

On the reference controller host, pin the device and start the listener:

```sh
node apps/controller/cli.mjs add-outbound macbook DEVICE_PUBLIC_KEY FULL_AGENT_AMP_ADDRESS http://CONTROLLER_TAILSCALE_IP:23112
node apps/controller/cli.mjs listen http://CONTROLLER_TAILSCALE_IP:23112
```

On the MacBook, using the existing locally assigned owner key:

```sh
systemctl --user stop ai-maestro-device
node clients/linux/cli.mjs connect http://CONTROLLER_TAILSCALE_IP:23112
```

Permit the MacBook to reach TCP 23112 on the controller through the tailnet policy. The local screen remains http://127.0.0.1:23111. Use its “Use this device” button or text box; the controller verifies the source and activates that device. The reference listener persists accepted input and delivers it with its configured `amp-send`; Maestro's embedded implementation supplies its own delivery callback. Transfer closes the former connection; configure the new controller address locally before reconnecting.

For a persistent outbound user service, use `clients/linux/ai-maestro-device-connect.service` and set ADP_CONTROLLER in the same service.env file. Enable only one bridge mode at a time.

## Output and owner extensions

On Omarchy, `sudo pacman -S --needed ffmpeg pipewire-pulse espeak-ng` supplies the media and optional speech adapters. Enable each output permission on the screen, or locally with `node clients/linux/cli.mjs grant display.text on` (likewise display.image and speaker.say).

For custom capabilities, create owner-controlled JSON and `.mjs` files under ADP_HOME/capabilities. The default ADP_HOME is ~/.config/ai-maestro-device. Example definition:

```json
{
  "name": "custom.greenhouse.temperature",
  "description": "Read the greenhouse temperature",
  "sensor": true,
  "activation": "active",
  "args": {"type":"object","properties":{},"required":[],"additionalProperties":false},
  "timeoutMs": 1000,
  "module": "temperature.mjs"
}
```

The local module must export `handle(args)` and return a JSON-compatible result. Implement a fixed sensor operation; do not interpret arguments as commands. Files and directory must belong to the device user, must not be symlinks, and must not be writable by group/others. Then grant only that name locally with `node clients/linux/cli.mjs grant custom.greenhouse.temperature on`. The controller cannot upload or modify these definitions.

Automated tests use synthetic sensors, audio and images. The MacBook's actual V4L2 camera, PulseAudio/PipeWire devices, speech output and Lola's real chat/media understanding still need the physical acceptance check above.
