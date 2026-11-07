# Backlog

Updated: 2026-11-06. This is the repository's internal work list, not a claim of feature availability. See [status rules](../SCHEMA.md) and [knowledge index](../index.md).

| ID | Priority | Status | Work | Depends on | External tracking |
| --- | --- | --- | --- | --- | --- |
| [B001](B001-kiosk-memory-growth.md) | P1 | Ready (investigation) | Diagnose and bound kiosk memory | Target-device profiling for final acceptance | [#20](https://github.com/agentmessaging/agent-device-protocol/issues/20), open |
| [F001](F001-avatar-package.md) | P2 | Proposed | Data-only avatar package and validation | S001 design acceptance | Internal record |
| [F002](F002-avatar-state-handoff.md) | P2 | Proposed | Authenticated avatar state and handoff | F001 digest/schema contract | Internal record |
| [F003](F003-browser-avatar-renderer.md) | P2 | Proposed | Browser renderer and Omarchy pilot | B001, F001, F002 | Internal record |
| [F004](F004-platform-renderers.md) | P3 | Proposed | Embedded/mobile/native adapters | F003; platform-specific design and hardware | Internal record |
| [F005](F005-kiosk-redesign.md) | P2 | In progress | Kiosk redesign, talk, grants, local preview | Physical-device acceptance; B001 soak | Internal record |

All implementation owners are currently unassigned. Start with B001; avatar packages can be designed while profiling is pending, but adding an animated renderer to the reported kiosk is gated on reliability evidence. The current task delivers documentation only. Each implementation gets its own branch and PR; split F004 into concrete per-platform items before implementation.

Previously closed issues #1/#2/#4/#6 remain closed. Maestro integration is tracked in its own repository; this backlog does not reopen those items or claim their downstream hardware/integration verification has occurred.
