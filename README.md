# AI Maestro Device Protocol

One locally assigned Maestro agent, identified by its AMP address and exclusive signing key, can discover a paired Linux computer and ask it for a health report or a camera snapshot. The agent runs on its usual host. The Linux machine runs a small device bridge as the desktop user. This is an experimental v1 protocol.

| Component | Implementation |
| --- | --- |
| [Device protocol](protocol/v1.md) | Signed registration, discovery, invocation and correlated results |
| [Shared SDK](packages/sdk) | Ed25519 envelopes, typed controller API and bounded HTTP transport |
| [Linux bridge](clients/linux) | Health, opt-in JPEG capture via V4L2, local permission changes |
| [Controller](apps/controller) | Pair, discover, invoke, save JPEG, optionally announce capabilities to an AMP agent |
| [Agent display](apps/display) | Kiosk orb and activity from Maestro, plus a local picture-in-picture mirror of camera snapshots |
| Future clients | [macOS](clients/macos), [mobile](clients/mobile), [embedded](clients/embedded) |
| Media | Live JPEG camera, microphone PCM/WAV and PCM speaker playback with separate local consent |

## Implementation status

The Linux implementation includes fixed MCP agent tools, signed live camera/audio sessions, local media controls, a persistent status/AMP monitor and an optional protected Linux signer. [Install the agent tools and monitor](docs/agent-tools.md). The companion Maestro and plugin changes add the management view and agent skill. Physical camera/audio compatibility and the agent runtime's audio understanding still need verification on each target device. Other platform directories contain plans.

## Run it

Follow the [two-machine Omarchy runbook](docs/omarchy.md) to pair Mini Lola with the 2010 MacBook, run health, and opt into camera access. [The integration notes](docs/integration.md) map this implementation to Muse and Maestro and explain its trust boundary.

**Already paired?** [Start the agent display and publisher](docs/omarchy.md#7-show-the-assigned-agent-and-its-camera-picture-on-the-macbook).

For a one-computer check, clone the repo, install Node.js 22 or newer, then run:

```sh
npm ci --ignore-scripts
npm test
```

The test suite starts a real loopback HTTP bridge. Camera and AMP delivery use test adapters. To exercise two actual CLI processes without a tailnet or camera, run `bash tests/smoke.sh`.
