# F005 — Kiosk redesign, talk, grants and local preview

| Field | Value |
| --- | --- |
| Type / priority / status | Feature / P2 / in-progress |
| Owner | Juan Peláez |
| GitHub | None (internal record) |
| Spec | None; the owner approved a prototype element by element |
| Sources | Owner's approved prototype v6, not in this repository |
| Dependencies | B001: the page stays bound by its render, reload and presence rules |

## Problem and scope

The kiosk page gets the approved design: the agent's channel above, the person's below. It also closes a real gap: "Stop & revoke media" left `peer.camera` on, so still pictures kept working. Talking did not stop the agent's speech, and the transcription mixed the two voices. The waves show real levels from the bridge. The person sees their own local preview, which the agent never receives.

The host decides what to send. `display.text` carries her words; a transcript uses the prefix `You said: `.

## Acceptance

- [x] Four switches map to the eight grants; a switch reads on only if all of its grants are on.
- [x] Stop and Camera off deny `camera.snapshot`; stop covers every grant.
- [x] A talk session kills running speech and drops what arrives.
- [x] Levels come from PCM chunks and the WAV being played.
- [x] The page makes no external requests.
- [ ] Physical acceptance: ffmpeg preview on `/dev/video0`, aplay, espeak-ng and microphone levels on the target device.
- [ ] 24-hour soak with the MJPEG preview on the target device (S002).

## Evidence and status history

2026-11-06: tests in `tests/kiosk.test.mjs` with fake hardware. Browser check at 1280x800 in Chromium on macOS against a harness: real display server, `CameraPreview` and `Voice`, with ffmpeg's lavfi test source in place of the camera, a timer in place of aplay and generated PCM in place of the microphone. This is simulated, not physical-device evidence. Open: no soak has run with the preview; the level curve in `loudness` is uncalibrated against a real microphone.
