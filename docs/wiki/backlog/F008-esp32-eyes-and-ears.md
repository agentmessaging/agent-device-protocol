# F008 — ESP32-S3 board as an agent's eyes and ears

| Field | Value |
| --- | --- |
| Type / priority / status | Feature / P2 / proposed |
| Owner | Unassigned |
| GitHub | None (internal record) |
| Spec | [S003](../specs/S003-encrypted-home-network-connection.md), [typed capabilities](../../../protocol/capabilities.md), [outbound profile, device events](../../../protocol/reverse.md#device-events-and-input) |
| Sources | Owner request, 2026-11-22: two Seeed XIAO ESP32-S3 Sense boards, one for each of two agents |
| Dependencies | [F007](F007-encrypted-home-network-connection.md); [F006](F006-esp32-client.md) firmware built for esp32s3; the boards |

## Problem and scope

Extend the ESP32 client so a XIAO ESP32-S3 Sense (OV2640/OV3660 camera, PDM microphone, 8 MB PSRAM) can be an agent's eyes and ears:

- Connect through `/v1/secure` only (S003), never plain.
- `camera.snapshot`: JPEG, at most 1 MiB, with the visible capture sign required by [capabilities.md](../../../protocol/capabilities.md#visible-capture-indication). The board's user LED is the sign; the capture waits until it is on, and it stays on at least three seconds.
- Talk control: a button press records up to 20 seconds of 16 kHz mono audio and sends it as a signed `audio` event, with the LED on while recording. Never sent unprompted.
- `speaker.play` through an external I2S amplifier (MAX98357A), WAV at most 384 KiB; `{played:false}` while the person talks.
- Large messages in PSRAM, not the 16 KiB buffer.
- Local grants on the board (camera, microphone, speaker), off by default, and a local stop.

## Acceptance

- [ ] Host build of the C core: S003 test vectors, snapshot, audio and speaker messages against the SDK hub through `/v1/secure`.
- [ ] Firmware compiles with ESP-IDF for esp32s3.
- [ ] On a XIAO ESP32-S3 Sense: secure connection at a private address, health, snapshot with the LED sign, talk control to text at the controller, speaker playback, local stop, reconnect.

## Evidence and status history

2026-11-22: proposed. No code yet.
