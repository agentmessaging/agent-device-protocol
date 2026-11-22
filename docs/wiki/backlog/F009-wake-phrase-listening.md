# F009 — Wake phrase listening on boards and kiosks

| Field | Value |
| --- | --- |
| Type / priority / status | Feature / P2 / proposed |
| Owner | Unassigned |
| GitHub | None (internal record) |
| Spec | [S004](../specs/S004-wake-phrase-listening.md) |
| Sources | Owner request, 2026-11-22: "Hey Bruce" on the XIAO board and "Hey Lola" on the kiosks, with no button to press |
| Dependencies | S004 acceptance; [F008](F008-esp32-eyes-and-ears.md) microphone and speaker on the board; [F005](F005-kiosk-redesign.md) kiosk talk path |

## Problem and scope

- A training pipeline for one model per phrase, with microWakeWord (synthetic voices from Piper, then augmentation). First phrases: "hey bruce" and "hey lola". The pipeline goes in the repository. The models do not, until they are trained on data whose terms allow it (the current noise and negative sets are for non-commercial use).
- The ESP32 firmware: a detector on the PDM microphone, the two signs on the user LED (dim for listening, bright for recording), end of speech by silence, the `audio` event and the follow-up window.
- The kiosk bridge: the same detector on the bridge's microphone, and the two signs on the screen.

## Acceptance

- [ ] Pipeline: one command trains a phrase and reports recall and false wakes per hour on the held-out sets.
- [ ] Models for "hey bruce" and "hey lola" that meet the S004 targets in a real room.
- [ ] Board: the S004 board evidence.
- [ ] Kiosk: the S004 kiosk evidence.

## Evidence and status history

2026-11-22: proposed with S004.
