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

2026-11-23, branch `feat/esp32-wake-phrase`: the detector runs on the XIAO (microWakeWord model, 13-operation TFLite Micro interpreter, 26 KB arena, 100 inferences every 3 s). A board-recorded "Hey Bruce" from a Mac voice was detected (59 to 62%), and the clip that followed was transcribed exactly ("Can you tell me a story about the dragon?"), without the phrase. The owner's own "Hi Bruce, are you there" was detected (62%). Found and fixed: the PDM level is about 24 dB below the clips the model was checked on, so the detector gets the recording's low cut and a 16x gain. Still open on the board:

- [B002](B002-first-words-after-wake-phrase-lost.md): words said right after the phrase are lost.
- Scores are close to the cutoff. Retrain with board-level audio (the board's own microphone, more voices, distance) and measure false wakes per hour in a real room before lowering the cutoff.
- The models use non-commercial data: a product needs a retrain on clean data.
- CPU use while listening is not measured (S004 target: under 15% of one core).
- A test for end of speech that starts from the room level learned while listening (`adp_vad_restart`).
- A test controller that plays back every clip loops with the answer window; test with playback off.
