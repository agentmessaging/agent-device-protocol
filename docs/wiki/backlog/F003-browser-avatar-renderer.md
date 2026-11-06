# F003 — Render portable avatars in the browser kiosk

| Field | Value |
| --- | --- |
| Type / priority / status | Feature / P2 / Proposed |
| Owner | Unassigned |
| GitHub | None; this is the internal issue |
| Specs | [S001](../specs/S001-portable-agent-avatars.md), [S002](../specs/S002-kiosk-memory-lifecycle.md) |
| Source | [User request](../raw/2026-11-06-avatar-planning-request.md) |
| Dependencies | [B001](B001-kiosk-memory-growth.md), [F001](F001-avatar-package.md), [F002](F002-avatar-state-handoff.md) |

Implement one shared browser renderer used by the Linux display, with local package selection, opt-in, frame-rate/memory bounds and fallback to the existing orb. A MacBook/Pi running a browser may share code; actual Pi support still needs a target-device test.

- [ ] Preserve aspect ratio, status legibility and safety UI at landscape, small square and simulated round sizes.
- [ ] Animate supported states locally; support poster fallback and reduced motion with no added sensor permission.
- [ ] Maintain one loop, bounded package/decoded-image resources and generation-aware cleanup during transfer, package switch and visibility changes.
- [ ] Keep stop, approval, capture indicators and PiP usable above the avatar; verify failure/fallback paths.
- [ ] Pass S002 with avatars off and on, plus target Omarchy acceptance and documented rollback.

Evidence: design only; the shipped display still uses the orb. Future branch: `feat/F003-browser-avatar`. [Backlog](index.md).
