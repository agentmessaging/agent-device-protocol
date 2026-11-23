# Wiki change log

Append new entries; preserve prior history. Dates use America/Denver.

## [2026-11-06] ingest | Avatar planning and kiosk report

Established the repository wiki, schema, navigation and templates. Captured [issue #20](raw/2026-11-06-issue-20.md), [user request](raw/2026-11-06-avatar-planning-request.md), [reference notes](raw/2026-11-06-reference-notes.md) and [static code observations](raw/2026-11-06-display-code-observations.md).

Added proposed [S001](specs/S001-portable-agent-avatars.md), [S002](specs/S002-kiosk-memory-lifecycle.md), [D001](decisions/D001-local-avatar-rendering.md), and the [backlog](backlog/index.md). B001 is the immediate reliability priority; avatar implementation is future work. No runtime code, dependency, service, hardware permission or deployed device changed. Issue #20 is not resolved by writing this plan.

## [2026-11-06] lint | Initial documentation review

Checked all 20 Markdown files in this change, 104 local Markdown links, index coverage and whitespace. All local targets exist and each wiki page is indexed. Confirmed all changes are Markdown, proposed features remain labelled unimplemented, B001 remains open, and the implemented protocol files are unchanged. Runtime tests and a physical-device soak were not performed for this documentation-only change.

## [2026-11-06] fix | Kiosk lifecycle bounds

Measured the display page: no leak reproduced in headless Chrome on macOS. Bounded presence and control requests, skipped rendering of unchanged state, and added a six-hour idle reload as a safety net. See [B001](backlog/B001-kiosk-memory-growth.md). Issue #20 stays open for target-device evidence.

## [2026-11-06] feature | Kiosk redesign

Built the owner's approved kiosk design as the real page, with [F005](backlog/F005-kiosk-redesign.md): tap to talk that silences the agent, real levels, four grant switches, a local camera preview, and a local stop that covers every grant, including `camera`. Tested with fake hardware and in a browser against a simulated bridge; physical-device acceptance and a soak with the preview remain open. [B001](backlog/B001-kiosk-memory-growth.md) stays open.

## [2026-11-13] feature | ESP32 client

Added the ESP32 client in `clients/embedded/esp32` with [F006](backlog/F006-esp32-client.md): ESP-IDF firmware, outbound WebSocket, device key in NVS, `device.health` and optional `display.text`. Its C protocol core, compiled for the host, passes `tests/esp32-client.test.mjs` against the SDK signer and hub. No ESP-IDF toolchain was available, so the firmware was not compiled, and no board was used. Open protocol questions are in the client README; `protocol/` is unchanged.

## [2026-11-22] spec | Encrypted home network connection

Wrote [S003](specs/S003-encrypted-home-network-connection.md), proposed: a `/v1/secure` path with a signed X25519 key exchange and ChaCha20-Poly1305 messages, keyed from the pinned keys, so a board on a home network can use its camera, microphone and speaker. Added [F007](backlog/F007-encrypted-home-network-connection.md) for the SDK and [F008](backlog/F008-esp32-eyes-and-ears.md) for a XIAO ESP32-S3 Sense. Corrected an assumption: the outbound profile already carries messages up to 2,200,000 bytes, so snapshots and audio need no chunking; the 16 KiB limit is the ESP32 firmware's. Documentation only: `protocol/` and code are unchanged, and nothing was run.

## [2026-11-22] feature | Encrypted home network connection in the SDK

Implemented [S003](specs/S003-encrypted-home-network-connection.md) in the SDK with [F007](backlog/F007-encrypted-home-network-connection.md) and moved the contract into `protocol/reverse.md`. The hub now also enforces the home network limits on plain connections from private addresses, which reverse.md required but the SDK did not check. Tested on one computer with simulated home addresses; no board was used. [F008](backlog/F008-esp32-eyes-and-ears.md) (the ESP32 side) remains proposed.

## [2026-11-22] feature | S003 in the ESP32 C core

Added the S003 encrypted connection to the ESP32 C core for [F008](backlog/F008-esp32-eyes-and-ears.md): `adp_receive()`, the signed X25519 key exchange, HKDF-SHA256 keys and ChaCha20-Poly1305 messages with implicit counters, all with libsodium. The host build passes the S003 test vectors and connects to the SDK hub through `/v1/secure`. Not compiled with ESP-IDF, no board used, and the firmware does not call it yet.

## [2026-11-22] feature | S003 in the ESP32 firmware, first board

`main.c` connects through `/v1/secure` by default (`ADP_SECURE`) and passes text and binary frames to `adp_receive()` ([F008](backlog/F008-esp32-eyes-and-ears.md)). Compiled with ESP-IDF v5.5.6 for esp32s3 and flashed to a XIAO ESP32-S3 Sense: eFuse key, device key in encrypted NVS and Wi-Fi worked; the XIAO needs its external antenna to join. No session with a controller yet.

## [2026-11-22] feature | Camera snapshot on the XIAO ESP32-S3 Sense

`camera.snapshot` in the C core and the firmware ([F008](backlog/F008-esp32-eyes-and-ears.md)): offered only with the owner's camera option, the encrypted connection and a camera found at boot; the user LED is the capture sign and the camera runs only for the picture. On the board, through `/v1/secure` from a home network address to an SDK hub: discovery, health and two real 1024×768 snapshots of about 22 KB in about 2.3 s each.

## [2026-11-22] spec | S004 listening for a wake phrase

Proposed [S004](specs/S004-wake-phrase-listening.md) and [F009](backlog/F009-wake-phrase-listening.md). The owner wants a board inside a toy, and the kiosks, to work without a button. S004 adds a local `listen` grant (off by default; the controller cannot turn it on), keeps listening audio in RAM only (at most 2 s, never stored or sent), requires a listening sign that is different from the recording sign, and turns a detection into the existing `audio` event with no wire change. It also adds an 8 s follow-up window after a reply and an optional `wakePhrase` register field. Design only: nothing is implemented. Source: Meta's Muse Gadgets SDK, read 2026-11-22 (opt-in "Hey Muse", off by default).

## [2026-11-22] feature | ESP32 hardware doctor

New `ADP_DOCTOR` build option for the XIAO ESP32-S3 Sense ([F008](backlog/F008-esp32-eyes-and-ears.md)): at boot it checks chip, PSRAM, LED, Wi-Fi, the controller address, the microphone, the speaker (a tone the microphone must hear) and the camera. On the board everything passed except the speaker, whose wiring is being checked.

## [2026-11-22] feature | ESP32 talk button and speaker

The XIAO ESP32-S3 Sense records what a person says after a BOOT press and sends it as a signed `audio` event, and plays `speaker.play` on a MAX98357A ([F008](backlog/F008-esp32-eyes-and-ears.md)). On the board, the clip's speech-to-text matched the spoken sentence, and a person understood the speaker at 12% volume. The debug build sends logs over UDP and takes `talk` and `hear` from the USB console, so these tests run without a person at the board.
