# F006 — ESP32 device client

| Field | Value |
| --- | --- |
| Type / priority / status | Feature / P3 / in-progress |
| Owner | Unassigned |
| GitHub | None (internal record) |
| Spec | [Outbound connections](../../../protocol/reverse.md), [v1](../../../protocol/v1.md), [typed capabilities](../../../protocol/capabilities.md) |
| Sources | Owner request, 2026-11-13; [embedded README](../../../clients/embedded/README.md) |
| Dependencies | An ESP-IDF 5.1+ toolchain and a board; a decision on the transport for boards that cannot run Tailscale |

A concrete embedded item split from [F004](F004-platform-renderers.md)'s platform list, without avatar rendering.

## Problem and scope

A small ESP32 board should be an agent device: its own Ed25519 key kept on the board, a connection out to the owning agent's controller, signed `device.health`, and `display.text` only where the board has a screen. Camera, microphone, speaker, events and transfers are out of scope.

## Acceptance

- [x] Protocol core signs byte for byte like the SDK (RFC 8032 test key) and opens SDK-signed packets.
- [x] Core connects to the SDK `ReverseHub`, answers discovery, health and text, refuses reused challenges, foreign signatures, undeclared capabilities and bad arguments, and is refused as `not_owner` when it names another agent.
- [ ] Firmware compiles with ESP-IDF for esp32 and esp32s3.
- [ ] On a board: first-boot key creation, encrypted NVS on S3/C3, pairing, health, text, reconnect backoff and final refusal.
- [ ] Transport decision for boards without Tailscale (README open question 1).

## Evidence and status history

2026-11-13, branch `feat/esp32-client`: `node --test tests/esp32-client.test.mjs` passes 5 of 5 on macOS with Homebrew libsodium 1.0.20 and cJSON 1.7.18, also under AddressSanitizer and UndefinedBehaviorSanitizer. No ESP-IDF toolchain was installed, so the firmware (`main/main.c`) was not compiled. No board was used.
