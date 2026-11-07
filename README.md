# Agent Device Protocol (ADP)

**An open protocol for AI agents to own and use real devices.** A laptop, a camera, a screen in the kitchen: signed, approved on the device itself, and with no cloud in the middle.

Website: **[agentdevices.org](https://agentdevices.org)**

Status: **v1, experimental.** Companion to [AMP](https://agentmessaging.org) (messages), [AID](https://agentids.org) (identity), [AAP](https://agentactions.org) (UI actions) and [AFP](https://agentfiles.org) (files). Reference controller: [AI Maestro](https://aimaestro.sh).

## The idea

Agents live in terminals and servers. People live in rooms. ADP gives an agent a presence in the physical world without handing it the keys to your home.

```
agent:   "take a photo with the kitchen device"
         the agent's controller signs the request and sends it straight to the device
device:  checks the signature, the owner and the local grant, lights its in-use sign, captures, signs the result
agent:   gets the picture
```

- **A device is optional.** An agent with no device is complete. Most agents have none.
- **An agent can own many devices, and is active on at most one.** It jumps between them. It never sees through two cameras at once.
- **A device has zero or one owner.** The device's signed answer is the truth, not anyone's records.
- **The person at the device has the last word.** Camera, microphone and speaker are off until granted there. Ownership changes wait for approval there. A controller cannot turn off the in-use sign.
- **No cloud, no relay.** Device and controller talk directly, signed end to end with Ed25519.
- **Fixed operations only.** No remote shell, no arbitrary files, no remote code.

## Roles

| Role | What it does | Defined in |
|---|---|---|
| **Device** | Owns the hardware and the local grants. Answers signed requests | [protocol/v1.md](protocol/v1.md), [capabilities](protocol/capabilities.md) |
| **Controller** | Acts for agents: keys, inventory, the active device, liveness. One process can serve many agents | [protocol/controller.md](protocol/controller.md) |

Devices either answer on HTTP or open their own connection to the controller ([protocol/reverse.md](protocol/reverse.md)), which is how a device behind a home router or a phone reaches it.

## Implementations

| Component | Implementation |
| --- | --- |
| [Device protocol](protocol/v1.md) | Signed registration, typed capabilities, local approvals and correlated results |
| [Shared SDK](packages/sdk) | Host-wide multi-agent Controller SDK, HTTP and outbound WebSockets |
| [Linux bridge](clients/linux) | Health, camera/audio, text/image/speech output and owner-installed custom capabilities |
| [Controller](apps/controller) | Reference CLI/MCP controller, inventory, activation and optional AMP delivery |
| [Agent display](apps/display) | The device's kiosk: talk and typing, real voice levels, local preview, four grant switches, output and capture indicator |
| Future clients | [macOS](clients/macos), [mobile](clients/mobile), [embedded](clients/embedded) |
| Media | Live JPEG camera, microphone PCM/WAV and PCM speaker playback with separate local consent |

## For agents

[skills/agent-devices](skills/agent-devices/SKILL.md) teaches an agent to use its devices, and [scripts/adp-device.sh](scripts/adp-device.sh) is its command, as in the sister protocols. AI Maestro ships both in its plugin.

## Status

- Controller role, SDK, Linux device bridge, typed capabilities, device-opened connections, local approvals and the conformance suite are in place.
- [AI Maestro](https://github.com/23blocks-OS/ai-maestro) is implementing the controller role directly in its server, and passes the conformance suite.
- Hardware acceptance on real camera and audio devices is in progress. Live media over device-opened connections is not done yet.
- macOS, mobile and embedded devices are future work.

**A note on the name.** The protocol began inside AI Maestro, so the signature domain is still `ai-maestro-device/1` and the SDK package is `@ai-maestro/device-sdk`. The signature domain is part of the wire format: changing it would break every signature, so it stays for v1.

Read [the controller contract](protocol/controller.md) and the [server SDK guide](docs/controller-sdk.md) to build a controller, and [the reference runbook](docs/agent-tools.md) to try it.

## Planning and repository knowledge

The [versioned wiki](docs/wiki/index.md) contains the [backlog](docs/wiki/backlog/index.md), proposed specifications, source records and decisions. Start with [kiosk memory reliability](docs/wiki/specs/S002-kiosk-memory-lifecycle.md) (reported issue #20) and [portable agent avatars](docs/wiki/specs/S001-portable-agent-avatars.md). These are plans, not shipped features or a claim that the kiosk bug is fixed. [Contributor instructions](AGENTS.md) explain how to keep the records current.

## Run it

Follow the [two-machine Omarchy runbook](docs/omarchy.md) to pair Mini Lola with the 2010 MacBook, run health, and opt into camera access. [The integration notes](docs/integration.md) map this implementation to Muse and Maestro and explain its trust boundary.

**Already paired?** [Start the agent display and publisher](docs/omarchy.md#7-show-the-assigned-agent-and-its-camera-picture-on-the-macbook).

For a one-computer check, clone the repo, install Node.js 22 or newer, then run:

```sh
npm ci --ignore-scripts
npm test
```

The test suite starts a real loopback HTTP bridge. Camera and AMP delivery use test adapters. To exercise two actual CLI processes without a tailnet or camera, run `bash tests/smoke.sh`.

## License

[MIT](LICENSE)
