# Muse SDK gap audit and implementation order

Reviewed November 5, 2026 against Muse commit `17f7ae3c2b070bcfebf1362b0c9f3ba12dc6697b` and device-protocol commit `f34517c`.

At the audited commit, the project was a prototype of signed device commands, a status display and a snapshot mirror. The intended agent-home experience still requires agent tool integration, a persistent device lifecycle, media, and deployment support. Passing the current tests establishes the implemented subset. Those tests do not exercise an agent answering a chat request with a device operation, authenticated voice sessions, live camera streams, or adversarial agents sharing an OS account.

## Implementation follow-up

The subsequent implementation adds MCP tools, a protected Linux signer, monitor notifications, signed media sessions and local consent/stop controls. The host-process Controller SDK now supports direct Maestro integration. Earlier Maestro and plugin PRs are on hold pending that integration. See [agent-tools.md](agent-tools.md) for setup and exact boundaries, including optional hardening and the need for physical hardware testing.

## Reported issues

| Report | Verified gap | Next implementation |
| --- | --- | --- |
| [#1](https://github.com/agentmessaging/agent-device-protocol/issues/1) | PiP displays one snapshot. Microphone/speaker profiles are disabled and streams are empty. | A consented media-session profile, authenticated bounded transport, capture/playback adapters and visible local stop controls. |
| [#2](https://github.com/agentmessaging/agent-device-protocol/issues/2) | The agent has no installed device tool or per-agent device inventory. | Fixed discover/health/snapshot tools installed into the assigned agent session, with configured runtime and media results that the agent can consume. |
| [#3](https://github.com/agentmessaging/agent-device-protocol/issues/3) | A shared OS user can read the private controller key. The AMP address is an operator-established association. | Optional deployment hardening; the protocol does not require host-local isolation (see #16). |
| [#4](https://github.com/agentmessaging/agent-device-protocol/issues/4) | Maestro has no device inventory or management UI. | Registry, verified assignment, online/offline status, permission management and acknowledged transfer. Track integration under [Maestro #789](https://github.com/23blocks-OS/ai-maestro/issues/789). |
| [#5](https://github.com/agentmessaging/agent-device-protocol/issues/5) | Unit hardcodes Node, CLI setup output is confusing, and the runbook omits operational steps. | Fix the runtime path and CLI output, then document per-user runtime selection, pairing order, headless GitHub login, linger and a tailnet grant. |
| [#6](https://github.com/agentmessaging/agent-device-protocol/issues/6) | Announcements require a manual controller command. Offline detection and transfer notifications are absent. | A persistent controller-side inventory/liveness service with deduplicated notifications, restart recovery and retained previous-owner routing for transfers. |

### Authorization and deployment choice

Updated by issue #16: possession or use of an agent's controller key grants that agent's authority. Isolation between agents on one host is a deployment choice, not a protocol requirement. AI Maestro's shared-user deployment is supported. Separate accounts and the reference UID broker remain optional hardening. Device-local grants, approval, stop controls and visible capture indicators apply in every deployment.

## Historical comparison at the audited commit

| Area | Muse reference | Current Maestro implementation |
| --- | --- | --- |
| Pairing and onboarding | BLE onboarding, phone confirmation, persistent device identity and installed service | Manual public-key exchange, one local owner record |
| Connection lifecycle | Persistent encrypted session, device registration, reconnect/backoff and credential refresh | Independent signed HTTP requests; optional activity polling |
| Agent capabilities | Descriptions, typed parameters, configured commands, registration and invocation/result lifecycle | Two fixed command names with no parameters; no installed agent tool |
| Device-to-agent conversation | User messages with image/voice input, chat subscription and correlated replies | Optional inventory notification and one-way activity indicator |
| Realtime media | Bounded multiplexed streams and Linux voice-call lifecycle; video capabilities vary by board and application | Snapshot JPEGs and their local preview; audio disabled |
| Visual interface | Board-specific avatars, push-to-talk, settings, image display and status | Browser orb, four activity states and snapshot PiP |
| Hardware/platform support | Linux SDK plus substantial ESP32 firmware and board drivers | Linux reference bridge; other clients have planning documents |
| Installation and maintenance | Install/uninstall tooling, service, preserved pairing and diagnostics | Manual checkout, CLI and optional user unit |

Muse source references reviewed:

- [Linux service lifecycle](https://github.com/facebookincubator/muse-gadget-sdk/blob/17f7ae3c2b070bcfebf1362b0c9f3ba12dc6697b/linux/src/musegadget/service.py)
- [Control, chat and streaming implementation](https://github.com/facebookincubator/muse-gadget-sdk/blob/17f7ae3c2b070bcfebf1362b0c9f3ba12dc6697b/linux/src/musegadget/link_client.py)
- [Voice-call lifecycle](https://github.com/facebookincubator/muse-gadget-sdk/blob/17f7ae3c2b070bcfebf1362b0c9f3ba12dc6697b/linux/src/musegadget/voice_call.py)
- [Linux setup and supported interfaces](https://github.com/facebookincubator/muse-gadget-sdk/blob/17f7ae3c2b070bcfebf1362b0c9f3ba12dc6697b/linux/README.md)
- [ESP32 device-specific feature coverage](https://github.com/facebookincubator/muse-gadget-sdk/blob/17f7ae3c2b070bcfebf1362b0c9f3ba12dc6697b/esp32/README.md)

Muse also supplies generic command/file execution. Our capability policy remains explicitly allowlisted. Tailscale supplies the current private transport; adopting Muse's wire format or Noise implementation requires a separate compatibility decision.

## Delivery sequence and completion tests

1. **Repair installation (#5).** A fresh Omarchy install and an existing pairing both start under the selected user-local Node runtime, survive the configured logout/reboot behavior, and show actionable confirmations.
2. **Make the agent use its home (#2, #3, #6).** In the assigned agent's real chat, “take a photo with the MacBook” finds the device, captures an image, delivers an agent-consumable result and updates PiP. A second agent fails. Offline devices return a clear error. Announcements recover after restart.
3. **Add interactive media (#1).** Camera and microphone have separate local consent and visible on/off controls. The agent-side consumer actually receives frames/audio and can return speech. Stop, revoke, transfer, disconnect, slow consumption and malformed frames all terminate or bound resource use predictably. Real hardware tests establish latency and buffer limits.
4. **Manage homes in Maestro (#4 / #789).** The dashboard reflects signed device confirmation, handles offline transfers, and surfaces owned endpoints in each agent's profile.
5. **Add hardware targets.** Port the tested lifecycle and media profiles to actual Raspberry Pi, mobile or embedded hardware. Each port includes a tested capability matrix.

### Gaps beyond the six issues

A complete home also needs user-to-agent text and push-to-talk routing with reply correlation, speaker output, cancellation/interrupt behavior, version/capability negotiation, richer typed capability descriptions, and deployment-level observability. The current state display reads Maestro's status; it supplies no conversation input.

Automatic offline notification belongs on a reachable controller/host service. A powered-off device cannot emit that event. Automatic registration needs a trusted identity-to-device inventory path so a peer cannot grant itself control.
