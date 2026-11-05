# AI Maestro Device Protocol

A Maestro agent on one machine can discover a paired Linux computer and ask it for a health report or a camera snapshot. The agent runs on its usual host. The Linux machine runs a small device bridge as the desktop user. This is an experimental v1 protocol.

| Component | Implementation |
| --- | --- |
| [Device protocol](protocol/v1.md) | Signed registration, discovery, invocation and correlated results |
| [Shared SDK](packages/sdk) | Ed25519 envelopes, typed controller API and bounded HTTP transport |
| [Linux bridge](clients/linux) | Health, opt-in JPEG capture via V4L2, local permission changes |
| [Controller](apps/controller) | Pair, discover, invoke, save JPEG, optionally announce capabilities to an AMP agent |
| Future clients | [macOS](clients/macos), [mobile](clients/mobile), [embedded](clients/embedded) |
| Audio | Microphone and speaker adapter profiles reserved. Streaming is deferred. |

## Run it

Follow the [two-machine Omarchy runbook](docs/omarchy.md) to pair Mini Lola with the 2010 MacBook, run health, and opt into camera access. [The integration notes](docs/integration.md) map this implementation to Muse and Maestro and explain its trust boundary.

For a one-computer check, clone the repo, install Node.js 22 or newer, then run:

```sh
npm ci --ignore-scripts
npm test
```

The test suite starts a real loopback HTTP bridge. Camera and AMP delivery use test adapters. To exercise two actual CLI processes without a tailnet or camera, run `bash tests/smoke.sh`.
