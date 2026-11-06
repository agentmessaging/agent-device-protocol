# AI Maestro Device Protocol

Each device has one locally approved agent owner. An agent may own many devices and be active on at most one. A controller can serve all agents on a host in one process; AI Maestro implements that role directly. This experimental v1 includes signed device operations, outbound connections, user input, live HTTP media and a local display with approval and capture indicators.

| Component | Implementation |
| --- | --- |
| [Device protocol](protocol/v1.md) | Signed registration, typed capabilities, local approvals and correlated results |
| [Shared SDK](packages/sdk) | Host-wide multi-agent Controller SDK, HTTP and outbound WebSockets |
| [Linux bridge](clients/linux) | Health, camera/audio, text/image/speech output and owner-installed custom capabilities |
| [Controller](apps/controller) | Reference CLI/MCP controller, inventory, activation and optional AMP delivery |
| [Agent display](apps/display) | Agent activity, PiP, text input, local grants, output and capture indicator |
| Future clients | [macOS](clients/macos), [mobile](clients/mobile), [embedded](clients/embedded) |
| Media | Live JPEG camera, microphone PCM/WAV and PCM speaker playback with separate local consent |

## Implementation status

Read [the controller contract](protocol/controller.md) and [server SDK guide](docs/controller-sdk.md) for direct AI Maestro integration. [The reference runbook](docs/agent-tools.md) supports standalone testing and optional hardening. Shared-user deployments are supported; the protocol does not require account isolation.

AI Maestro #791 and plugin #99 are on hold while Maestro adopts the controller role directly. Physical MacBook camera/audio acceptance and the agent runtime's audio understanding still need target-device testing. Outbound connections currently carry snapshots, typed operations and text events; live media remains on the HTTP profile. Other platform directories contain plans.

## Run it

Follow the [two-machine Omarchy runbook](docs/omarchy.md) to pair Mini Lola with the 2010 MacBook, run health, and opt into camera access. [The integration notes](docs/integration.md) map this implementation to Muse and Maestro and explain its trust boundary.

**Already paired?** [Start the agent display and publisher](docs/omarchy.md#7-show-the-assigned-agent-and-its-camera-picture-on-the-macbook).

For a one-computer check, clone the repo, install Node.js 22 or newer, then run:

```sh
npm ci --ignore-scripts
npm test
```

The test suite starts a real loopback HTTP bridge. Camera and AMP delivery use test adapters. To exercise two actual CLI processes without a tailnet or camera, run `bash tests/smoke.sh`.
