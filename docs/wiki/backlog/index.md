# Backlog

Updated: 2026-11-23. This is the repository's internal work list, not a claim of feature availability. See [status rules](../SCHEMA.md) and [knowledge index](../index.md).

| ID | Priority | Status | Work | Depends on | External tracking |
| --- | --- | --- | --- | --- | --- |
| [B001](B001-kiosk-memory-growth.md) | P1 | Ready (investigation) | Diagnose and bound kiosk memory | Target-device profiling for final acceptance | [#20](https://github.com/agentmessaging/agent-device-protocol/issues/20), open |
| [F001](F001-avatar-package.md) | P2 | Proposed | Data-only avatar package and validation | S001 design acceptance | Internal record |
| [F002](F002-avatar-state-handoff.md) | P2 | Proposed | Authenticated avatar state and handoff | F001 digest/schema contract | Internal record |
| [F003](F003-browser-avatar-renderer.md) | P2 | Proposed | Browser renderer and Omarchy pilot | B001, F001, F002 | Internal record |
| [F004](F004-platform-renderers.md) | P3 | Proposed | Embedded/mobile/native adapters | F003; platform-specific design and hardware | Internal record |
| [F005](F005-kiosk-redesign.md) | P2 | In progress | Kiosk redesign, talk, grants, local preview | Physical-device acceptance; B001 soak | Internal record |
| [F006](F006-esp32-client.md) | P3 | In progress | ESP32 device client: health and optional text | A board, an ESP-IDF build and a transport decision | Internal record |
| [F007](F007-encrypted-home-network-connection.md) | P2 | Done | Encrypted home network connection in the SDK (S003) | — | Internal record |
| [F008](F008-esp32-eyes-and-ears.md) | P2 | In progress | ESP32-S3 eyes and ears: camera, talk control, speaker | F007, F006 firmware build, the boards | Internal record |
| [F009](F009-wake-phrase-listening.md) | P2 | In progress | Wake phrase listening: models, board and kiosk (S004) | S004 acceptance, F008 microphone and speaker | Internal record |

## Mobile toy (Bruce)

A board inside a toy that travels with its person: no screen, no button, any network. These items come from the first on-board tests of F008 and F009 (2026-11-23).

| ID | Priority | Status | Work | Depends on | External tracking |
| --- | --- | --- | --- | --- | --- |
| [B002](B002-first-words-after-wake-phrase-lost.md) | P2 | Ready | Words said right after the wake phrase are lost | S004 amendment | Internal record |
| [F010](F010-board-wifi-networks.md) | P2 | Proposed | Join the networks of the places it travels to; networks from the controller or the AI Maestro app | A device network setup spec; F011 | Internal record |
| [F011](F011-controller-from-anywhere.md) | P2 | Proposed | Reach the controller from anywhere through a public tunnel | S003 amendment | Internal record |
| [F012](F012-louder-speaker-usb-board.md) | P3 | Proposed | Louder, clean speech on a USB-powered board | Hardware changes | Internal record |

All implementation owners are currently unassigned. Start with B001; avatar packages can be designed while profiling is pending, but adding an animated renderer to the reported kiosk is gated on reliability evidence. The current task delivers documentation only. Each implementation gets its own branch and PR; split F004 into concrete per-platform items before implementation.

Previously closed issues #1/#2/#4/#6 remain closed. Maestro integration is tracked in its own repository; this backlog does not reopen those items or claim their downstream hardware/integration verification has occurred.
