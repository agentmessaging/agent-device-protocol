# Changelog

## Unreleased

- The kiosk sends `device.used` the moment a person taps the mic, before the recording, so a controller can get ready while they speak (AI Maestro F100 warms the agent's speaking side on it).
- The `agent-devices` skill says how to talk to a person at a device: answer at once without reading the inbox, and speak like a person, in short sentences with no paths, IDs, links, code or long numbers. The rule lives in the skill because the message itself is untrusted text.
- The hub tells `transcribe` whose clip it is: `transcribe(audio, { agent, device })`, so a host can hear each agent's devices the way that agent chose.
- An activity update can carry `hearing`, the speech service that hears the device, and the kiosk shows it under Microphone: "What you say is heard by ElevenLabs".
- The hub accepts a device whose socket sends the hub's own `Origin`, as iOS and Android socket libraries always do. Before, it dropped them with no log, so a phone could never connect. Any other `Origin` is still dropped, and now logged as a refusal.
- The kiosk's icon column is tighter and centred between the person's wave and the bottom of the screen.
- The kiosk settings no longer call every agent "her" or "she".
- Captions button on the kiosk: a small menu turns the agent's words and the person's words on or off, remembered on that screen.
- The bridge runs on macOS for your own Mac: `clients/linux/platform.mjs` holds the hardware commands.
- An activity update can carry `label`, the agent's display name, so a device shows "Lola" and not `pas-lola`.
- New kiosk page: the agent's voice and words above, the person's picture, voice and words below, with Outfit served from the device. Tap to talk, typing, four grant switches and real voice levels (`/levels`). `Use this device` is gone: talking or typing counts.
- Security: the local stop and the Camera switch now also turn off `camera`. Before, still pictures still worked after "Stop & revoke media". The local stop covers every grant.
- Talking stops the agent's speech at once: during a talk session `speaker.play` and `speaker.say` return `played:false`, so the microphone does not pick her up.
- Local camera preview on loopback, with `ADP_PREVIEW=off` for slow devices. It never reaches the agent.
- Hold to talk: a person holds a control on the device, and the recording reaches the controller as a signed `audio` event.
- A jump to the device already active changes nothing. Before, a person typing at a device cancelled what the agent was doing there.
- A controller says why it refused a device connection, and a device stops on a final refusal instead of retrying forever (#22).
- `serve` can also connect out with `ADP_CONTROLLER`, so a device keeps live media and gains device input.
- `speaker.play`: the device plays WAV audio the controller made, with its own grant, so an agent keeps one voice on every device.
- The `agent-devices` skill and `adp-device.sh`, the agent's command.
- Display: render only when the state changes, bound presence and control requests, and reload an idle kiosk after six hours while #20 is open.

## [0.1.0] - 2026-11-06 - Public debut

First public release of the Agent Device Protocol (ADP), under the MIT license.

- Protocol v1: signed registration, discovery and invocation; typed capabilities; owner-defined capabilities; local grants; a required in-use sign for cameras and microphones.
- Controller role: one process can serve many agents; an agent owns zero or more devices and is active on at most one.
- Device-opened connections.
- Locally approved ownership and permission changes.
- SDK, Linux bridge, reference controller, and a conformance suite for any controller.
