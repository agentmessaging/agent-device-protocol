# F007 — Encrypted home network connection

| Field | Value |
| --- | --- |
| Type / priority / status | Feature / P2 / ready |
| Owner | Unassigned |
| GitHub | None (internal record) |
| Spec | [S003](../specs/S003-encrypted-home-network-connection.md) |
| Sources | Owner request, 2026-11-22; [reverse.md, home network connections](../../../protocol/reverse.md#home-network-connections) |
| Dependencies | S003 accepted |

## Problem and scope

A board on a home network can only send health, screen text and "in use" today, because nothing encrypts its connection. Implement S003 in the SDK: the `/v1/secure` path in `ReverseHub`, `secure: true` in `DeviceConnection`, encrypted messages, the limits by source address, and test vectors. Then move the contract from S003 into `protocol/reverse.md`.

Not in scope: the ESP32 firmware ([F008](F008-esp32-eyes-and-ears.md)), the HTTP media profile, AI Maestro's listener (tracked in the AI Maestro repository).

## Acceptance

The SDK checklist in [S003, Acceptance](../specs/S003-encrypted-home-network-connection.md#acceptance-and-rollout), and `protocol/reverse.md` updated in the same PR.

## Evidence and status history

2026-11-22: spec S003 written. No code yet.
