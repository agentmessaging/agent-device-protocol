# B002 — Words said right after the wake phrase are lost

| Field | Value |
| --- | --- |
| Type / priority / status | Bug / P2 / fixed on `feat/esp32-wake-phrase` |
| Category | Mobile toy (Bruce) |
| Owner | Unassigned |
| GitHub | None (internal record) |
| Spec | [S004](../specs/S004-wake-phrase-listening.md) (rule: audio from before the detection is not sent) |
| Sources | Board test, 2026-11-23 |
| Dependencies | [F009](F009-wake-phrase-listening.md) |

## Problem and evidence

The owner said "Hi Bruce, are you there" without a pause. The board detected the phrase (62%, cutoff 59%) and sent a 1.26 s clip; speech-to-text of the clip: "there." "Are you" was lost.

The detector decides on the mean of the last five 30 ms steps, so it fires about 150 to 500 ms after the phrase ends. People do not pause after a name. S004 says recording starts at the detection and that audio from before it is not sent, so the words in that gap are lost.

## Fix

- Spec: amend S004 so the recording may start up to 500 ms before the detection, cut at the end of the phrase. Still nothing from before the phrase is sent. The rolling buffer stays inside the 2 second limit, in RAM only.
- Board: keep the last 500 ms of microphone audio in the listening loop (in RAM) and put it at the start of the recording.
- Test: a recording of "hey bruce what time is it" with no pause; speech-to-text of the clip contains "what time is it" and does not contain "hey bruce".

## Evidence and status history

2026-11-23: found on the board with `feat/esp32-wake-phrase`.

2026-11-23: fixed. S004 amended (PR #57). The board keeps a 480 ms ring of microphone audio in RAM while listening and puts it at the start of the recording; those frames only teach the room level, so the phrase alone still sends nothing. On the board: "Hey Bruce." then "Are you there?" with no gap gave a clip transcribed as "Are you there?".
