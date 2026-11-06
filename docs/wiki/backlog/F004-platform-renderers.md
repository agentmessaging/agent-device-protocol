# F004 — Plan additional avatar display platforms

| Field | Value |
| --- | --- |
| Type / priority / status | Feature / P3 / Proposed |
| Owner | Unassigned |
| GitHub | None; this is the internal issue |
| Spec | [S001](../specs/S001-portable-agent-avatars.md), platform/rollout sections |
| Source | [User request](../raw/2026-11-06-avatar-planning-request.md) |
| Dependencies | [F003](F003-browser-avatar-renderer.md) reference behavior; actual platform hardware and runtime constraints |

This is a planning umbrella, not one multi-platform implementation branch. Split it into separately identified items for each selected board/OS before coding. Candidate targets include Pi browser packaging, native macOS/Windows, mobile/watch and constrained embedded screens. No support is promised merely by listing them.

- [ ] Choose a concrete device/runtime and document memory, display, power and input limits.
- [ ] Reuse package/state semantics; define validated lower-resolution variants where necessary.
- [ ] Preserve local permission/safety controls and fail to text/poster when animation is unavailable.
- [ ] Verify actual round/small hardware, ownership/jump behavior, memory plateau, suspend/resume and battery behavior where applicable.
- [ ] Publish install/run and rollback steps backed by device evidence, in a separate platform-specific PR.

Evidence: none beyond the proposal. Platform framework choices and budgets remain open. [Backlog](index.md).
