# F002 — Add authenticated avatar state and handoff

| Field | Value |
| --- | --- |
| Type / priority / status | Feature / P2 / Proposed |
| Owner | Unassigned |
| GitHub | None; this is the internal issue |
| Spec | [S001](../specs/S001-portable-agent-avatars.md), state and activation sections |
| Source | [User request](../raw/2026-11-06-avatar-planning-request.md) |
| Dependencies | [F001](F001-avatar-package.md) package digest/schema contract |

Add optional discovery, typed SDK methods, a locally granted presentation state exchange and outbound RPC support. Preserve the existing `activity` contract and old-device fallback. A controller continues serving all of its agents in one process.

- [ ] Test profile negotiation and unsupported-device fallback without sending unknown types to legacy bridges.
- [ ] Validate signature, owner, revision, boot ID, challenge, ordering, payload bounds and local display grant for the proposed exchange.
- [ ] Coalesce and expire stale state, invalidate old-generation work on jump, and clear presentation on transfer/revoke.
- [ ] Test two agents, multiple devices, offline previous device, reconnect, forged messages and delayed state/package selection.
- [ ] Expose a typed host API and conformance tests for HTTP and outbound RPC; no Maestro code changes required to complete this repository's interface.
- [ ] Document that active hints are not device-enforced isolation and that offline visual disappearance is bounded by freshness, not instantaneous.

Evidence: design only; proposed packet names are not accepted by current bridges. Future branch: `feat/F002-avatar-state`. [Backlog](index.md).
