# Changelog

## Unreleased

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
