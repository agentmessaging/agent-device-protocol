# F008 — ESP32-S3 board as an agent's eyes and ears

| Field | Value |
| --- | --- |
| Type / priority / status | Feature / P2 / in progress |
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

- [x] Host build of the C core: S003 test vectors and the key exchange against the SDK hub through `/v1/secure`.
- [x] Host build of the C core: snapshot, audio and speaker messages through `/v1/secure`.
- [x] Firmware compiles with ESP-IDF for esp32s3.
- [ ] On a XIAO ESP32-S3 Sense: secure connection at a private address, health, snapshot with the LED sign, talk control to text at the controller, speaker playback, local stop, reconnect.

## Evidence and status history

2026-11-22: proposed. No code yet.

2026-11-22, branch `feat/esp32-secure-core`: the C core (`main/adp.c`) has S003: `adp_receive()` takes text or binary messages, `secure.hello` is checked against the pinned controller key (type, version, `to`, id and challenge format, ephemeral key, exactly six fields), the accept carries a new X25519 key, keys come from HKDF-SHA256 over the transcript, messages are ChaCha20-Poly1305 IETF with implicit counters, and the ephemeral secret and shared result are wiped. `node --test tests/esp32-client.test.mjs` passes 12 of 12 on macOS (Apple clang, libsodium 1.0.20): the published vectors (both X25519 public keys, both direction keys, the first ciphertext), discovery, health and text from the C core through `/v1/secure` to the SDK `ReverseHub` from a simulated home address, 4003 `not_owner` for another agent, refused hellos (another signer, another device, binary, a plain `hello`), and closing on a changed, replayed, plain or out-of-order message. `npm test`: 118 pass, 0 fail. Host build only: not compiled with ESP-IDF, not run on a board, and `main.c` does not call it yet.

2026-11-22, branch `feat/esp32-secure-firmware`: `main.c` uses S003. New Kconfig option `ADP_SECURE` (default on) selects `/v1/secure/DEVICE_KEY`; the WebSocket handler accepts text and binary frames up to `ADP_MAX_FRAME` + 16 bytes, passes them to `adp_receive()` and sends the answer as binary when the core says so. ESP-IDF v5.5.6, target esp32s3: the build completes with no warnings from this code (app 0x103ac0 bytes, 31% of the 1.5 MB partition free). Flashed to a XIAO ESP32-S3 Sense (ESP32-S3 rev v0.2, 8 MB PSRAM): it burned the eFuse HMAC key, created and printed its device key from encrypted NVS, and joined a WPA2 home network after the external antenna was attached (without it, every attempt timed out at `auth -> init`). Not yet run: a session with a controller, because the controller host was offline.

2026-11-22, branch `feat/esp32-camera-snapshot`: `camera.snapshot`. The core advertises it with `permissions.camera` only when the board port supplies a snapshot function, checks that the answer starts with the JPEG signature and is at most 1 MiB, and returns `{mime:"image/jpeg",data}` in standard base64; empty or omitted args only. The firmware offers it only with `ADP_CAMERA` (the owner's grant), the encrypted connection, and a camera that answered at boot. `board_camera.c` (XIAO Sense pins) lights the user LED, starts the camera, drops three warm-up frames, takes one 1024×768 JPEG, stops the camera, and turns the LED off three seconds later. New `sdkconfig.defaults.xiao-s3-sense` (octal PSRAM, 8 MB flash, camera on). Host tests: 14 of 14, including a 300 KiB snapshot through `/v1/secure` and no camera without the grant. On the board (OV3660 detected, 8 MB PSRAM found, device key kept across the reflash): encrypted connection from 10.0.0.107 to an SDK `ReverseHub` on a Mac's home address, discovery listed `device.health, camera.snapshot` with `permissions:{camera:true}`, health `esp32s3`, and two snapshots of 22,103 and 22,135 bytes, each in about 2.3 s, both real 1024×768 pictures of the room. LED sign not observed by a person yet. Still open: talk control, speaker, a local stop, and a session with AI Maestro.

2026-11-22, branch `feat/esp32-doctor`: a hardware doctor (`ADP_DOCTOR`, `board_doctor.c`) that runs once at boot and prints one line per part to the USB console. On the board, with a MAX98357A wired to D1/D4/D5: chip esp32s3 rev 0.2 with 8 MB flash, 8 MB PSRAM, Wi-Fi at -51 dBm, controller address reachable, PDM microphone live (room at -44 dBFS), camera 23,030 byte JPEG in 771 ms, and the LED blinked (a person must confirm it). Speaker FAIL: the microphone did not hear the 1 kHz test tone (-8.3 dB against the room), so the amplifier wiring is being checked. Protocol check on the same build against the SDK hub: encrypted connection, discovery, health `esp32s3`, and two snapshots of about 23 KB in about 2 s.

2026-11-22, branch `feat/esp32-talk-speaker`: talk button and `speaker.play`. C core: the signed `audio` event (microphone grant and encrypted connection only, one per event challenge, waits for its matching `event.ack`), `speaker.play` with the SDK's WAV checks (`builtinCapabilities` definition), and a 1 MiB frame limit when the speaker is on. Host tests 17/17, including a 300 KiB `speaker.play`, two audio events of 64 KB and 640 KiB through `/v1/secure`, and no audio without the grant or over a plain connection; end-of-speech tests 7/7 (`tests/esp32-vad.test.mjs`). Board, with a MAX98357A on D1/D4/D5 and an SDK hub at a home address: a sentence spoken by the Mac's `say` was recorded, ended one second after the speaker stopped (5.3 s), arrived 2 s later, and speech-to-text of the clip matched it word for word; the board's own microphone recorded its speaker saying a test sentence, and speech-to-text heard most of the words; a person heard clean speech at 12% volume. Found and fixed on the way: I2S timeouts passed in ticks instead of milliseconds (every microphone read gave up after 20 ms), an end-of-speech level that a fan or a slow microphone drift turned into 20-second recordings, 2 KB send fragments (580 KB took 14 s), and hardware: a shorted speaker, wires on the mirrored side of the board, loose jumpers. Not yet confirmed by a person: the LED sign. Still open: local stop, a session with AI Maestro.
