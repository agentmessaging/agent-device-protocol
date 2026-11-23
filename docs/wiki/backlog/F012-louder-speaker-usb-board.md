# F012 — Louder, clean speech on a USB-powered board

| Field | Value |
| --- | --- |
| Type / priority / status | Feature / P3 / proposed |
| Category | Mobile toy (Bruce) |
| Owner | Unassigned |
| GitHub | None (internal record) |
| Spec | None (hardware and audio processing; no wire change) |
| Sources | Owner report, 2026-11-23: "the volume is way too low"; measurements on the board the same day; notes from another agent, reviewed the same day |
| Dependencies | [F008](F008-esp32-eyes-and-ears.md) speaker |

## Problem and evidence

The XIAO ESP32-S3 Sense drives a MAX98357A from its USB 5 V pin over jumper wires; GAIN unconnected (9 dB), SD to 3V3. Measured on 2026-11-23:

- Firmware volume 12% (`ADP_SPEAKER_VOLUME`) with plain ElevenLabs speech (peaks -5.6 dBFS, average -22.5 dBFS): clean but too quiet.
- The same speech compressed (cut below 180 Hz; compressor -30 dB threshold, 6:1, 3 ms attack, 60 ms release, +10 dB; limiter at -1 dBFS) has an average of -14.8 dBFS: a person heard it "much louder" and clean at 12%.
- At 25%, 40% and 60% (debug console `vol N`) a person heard distortion.

At 25% the amplifier is far below its maximum output, so the distortion is most likely the supply: the speaker's current peaks pull the USB 5 V down through the jumper wires.

## Work, in order

1. **Supply:** a 470 µF capacitor (and a 0.1 µF ceramic) right at the amplifier's VIN and GND; soldered short wires. Measure again with `vol N`.
2. **Speech processing at the controller:** the compression above, applied by AI Maestro before `speaker.play` (AI Maestro repository). This is the biggest free gain and is already measured.
3. **Gain staging:** GAIN to VIN (6 dB) and software volume about 17% gives the same loudness with less amplifier hiss. It does not make speech louder.
4. **Speaker and enclosure:** a closed cavity behind the speaker inside the toy, the front at an opening. A 4 Ω speaker gives more power but draws about twice the current of 8 Ω, which makes supply dips worse: change the speaker only after step 1, or with a supply that gives more than USB's 500 mA.
5. **Sample rate:** ElevenLabs at 22.05 or 24 kHz instead of 16 kHz. The firmware accepts up to 48 kHz. Small gain on a small speaker; 50% more bytes per sentence (still under the 384 KiB limit for one sentence).

## Acceptance

- [ ] With step 1 done, the loudest clean `vol N`, judged by a person, and the doctor tone level, recorded here.
- [ ] A new default for `ADP_SPEAKER_VOLUME` if it changes, with the hardware it needs in the README.
- [ ] 24 kHz speech compared with 16 kHz by a person.

## Evidence and status history

2026-11-23: proposed, with the measurements above.
