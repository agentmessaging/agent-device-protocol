# S004 — Listening for a wake phrase

| Field | Value |
| --- | --- |
| Status | Proposed |
| Date | 2026-11-22; amended 2026-11-23 (B002) |
| Owner | Unassigned |
| Work | [F009](../backlog/F009-wake-phrase-listening.md); related [F008](../backlog/F008-esp32-eyes-and-ears.md), [F005](../backlog/F005-kiosk-redesign.md) |
| Sources | Owner request, 2026-11-22 (a board inside a toy, and the kiosks, must work without pressing a button); [Meta Muse Gadgets SDK](https://github.com/facebookincubator/muse-gadget-sdk), read 2026-11-22: an opt-in "Hey Muse" wake word on the device, off by default, that starts the same voice note as the talk button |

## Problem and evidence

Today a person talks to a device only through a talk control. The `audio` event is "what a person said while using a talk control" and "is sent only because the person chose to" ([reverse.md](../../../protocol/reverse.md#device-events-and-input)). A device with a camera or microphone shows a visible sign whenever it captures ([capabilities.md](../../../protocol/capabilities.md#visible-capture-indication)).

A board inside a toy has no button a child can find, and a kiosk across the room is out of reach. Both need hands-free use: the person says the agent's name ("Hey Bruce") and talks.

To hear the name, the microphone must run all the time. The protocol has no state for "the microphone runs, but nothing is kept or sent". Without one, an always-on microphone is either forbidden (no talk control) or a permanent capture.

Observed facts:

- Meta's Muse firmware runs a 23 KB int8 model on an ESP32-S3 at 8 to 9% of one core, with about 14 KB of internal RAM and 160 KB of PSRAM (their measurement, not ours). Their wake word is off by default, and the microphone stays powered while it listens.
- The SDK controller accepts register fields it does not know and ignores them (`packages/sdk/controller.mjs` reads only listed fields). It rejects event bodies with fields it does not know (`packages/sdk/reverse.mjs`).

## Scope and compatibility

Included: a local listening state, its grant and signs, how a detection becomes an `audio` event, a follow-up window after a reply, and an optional register field.

Not included: a wire change to the `audio` event (old controllers keep working), model delivery from a controller, speaker identification (that stays a controller guess, as today), and legal review for products for children.

## Proposed behavior

### Terms

- **Listening**: the device runs microphone audio through a local detector only to find the wake phrase. Nothing is kept or sent.
- **Recording**: the device keeps microphone audio to send it as an `audio` event. This is the capture that exists today.

### Grant

- New local grant `listen`, off by default. It needs the `microphone` grant.
- Only the device owner turns it on, at the device (a switch on the screen, a build option on a board). A controller cannot turn it on, and cannot see or change the phrase.
- The local stop turns it off with every other grant. A transfer turns it off.

### What listening may do with audio

- Audio is kept only in RAM, in a rolling buffer of at most 2 seconds that the detector needs.
- It is never written to storage, never logged, and never sent. The detector gives only one result: the phrase was heard, or not.

### Signs

- The listening sign is on for the whole time the device listens. The recording sign is on whenever the device records, as today.
- The two signs must be different for a person nearby: for example a dim light and a bright light, two colors, or a steady and a blinking light. On a screen, words such as "Listening for Hey Bruce" and "Recording".
- A device that cannot show two different signs must not offer listening.
- The kiosk's paint acknowledgment applies to both signs. A hidden, closed or unresponsive screen stops listening within the same 1.1 second bound as capture.

### From the wake phrase to an `audio` event

1. The detector hears the phrase. The recording sign comes on before recording starts.
2. Recording starts at the detection. It MAY include up to 500 ms of audio from just before the detection, because a detector decides after the phrase ends and people do not pause after a name ("Hi Bruce, are you there" lost "are you" on the board without it, [B002](../backlog/B002-first-words-after-wake-phrase-lost.md)). That audio can include the end of the phrase. Audio from earlier is not sent.
3. Recording ends when the person stops talking (the device chooses a silence between 0.6 and 2 seconds) or at the 20 second limit of the `audio` event.
4. If the person says nothing within 5 seconds of the phrase, nothing is sent and the device goes back to listening.
5. The result is the existing `audio` event, unchanged. Saying the wake phrase is the person's choice to talk to the device, so the rule "sent only because the person chose to" still holds.

### Follow-up after a reply

After the agent's speaker output ends, the device may record for up to 8 seconds without the wake phrase, so the person can answer. The recording sign is on for that whole window. The device sends audio only if it heard speech in that window. One window per reply.

### While the device plays

The device may keep listening while it plays. A detection stops playback, and the result is the same as when a person talks today (`{played:false}`). A device without echo cancellation must ignore detections while it plays, so it does not wake itself.

### Register

While `listen` is on, a device may add `permissions.listen: true` and the optional register field `wakePhrase`: 1–64 bytes of lowercase ASCII letters, spaces and apostrophes, for example `"hey bruce"`. It tells the agent what to tell people to say. It grants nothing, and old controllers ignore it.

### The detector model

The model is local data that the owner installs with the firmware or in the device's own files. A controller cannot install, change or remove it through this protocol, the same as handlers today.

## Acceptance and rollout

Proposed design targets, not measured results:

- At most one false wake in two hours with speech, TV or music in the room. At least 90% of wake phrases heard at 1 to 3 meters in a quiet room.
- On the XIAO ESP32-S3 Sense: listening and the detector use less than 15% of one core.

Required evidence:

- Board: the listening sign is on while listening; a detection lights the recording sign before recording; the `audio` event reaches the controller as text; nothing is sent when nobody talks; the local stop ends listening; and a packet capture during an hour of listening shows no audio leaving the board.
- Kiosk: the same, and hiding the screen stops listening within 1.1 seconds.

Rollout: off by default everywhere. No controller change is needed. When an implementation passes, the terms move to [capabilities.md](../../../protocol/capabilities.md) and [reverse.md](../../../protocol/reverse.md).

## Open decisions

- Model delivery from a controller (for example AI Maestro training a model when an agent is named, and sending it to the board). It needs signed, data-only models and the owner's local consent. Owner: unassigned. It blocks nothing in this spec.
- Training data for models in products. Data with non-commercial terms is fine for testing, but not for a product.
- Products for children need their own legal review of voice data. It is outside the protocol.
