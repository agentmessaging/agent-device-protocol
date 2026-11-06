# D001 — Local avatar rendering with a reliability gate

Status: Proposed. Date: 2026-11-06. Inputs: [request](../raw/2026-11-06-avatar-planning-request.md), [Muse reference](../raw/2026-11-06-reference-notes.md), [kiosk report](../raw/2026-11-06-issue-20.md).

## Decision proposed

Separate character assets, semantic state transport and platform rendering. Use locally approved data-only packages and a shared renderer where runtimes permit. The network carries bounded state changes; the device animates locally. Preserve the existing host-controller and single-owner model. Gate the first animated browser rollout on the kiosk reliability work.

## Alternatives and consequences

- Streaming rendered avatar video adds bandwidth, latency and a new media pipeline; defer it.
- Sending executable rendering code allows arbitrary behavior on the device; exclude it from the protocol. Locally built platform code remains a normal owner-controlled installation.
- Building an independent character implementation for every device makes appearance/state behavior drift; prefer shared packages and conformance with thin adapters.
- Using one full-fidelity package everywhere can exceed embedded budgets; permit explicit lower-budget variants and static fallback.
- Automatic package synchronization is convenient but needs a separate bounded transfer design. MVP local installation makes trust, resource limits and fallback concrete first.

Tradeoff: an agent can switch presentation to an already prepared device immediately, but an unprepared device shows the orb until its owner installs/approves matching artwork. Offline prior devices may display stale animation until the defined freshness timeout. This does not transfer the agent process or grant sensor access.

Related specs: [S001](../specs/S001-portable-agent-avatars.md), [S002](../specs/S002-kiosk-memory-lifecycle.md). Acceptance of this decision does not mark [backlog implementation](../backlog/index.md) complete.
