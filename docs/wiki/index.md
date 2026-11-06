# Device protocol knowledge index

Updated: 2026-11-06. Proposed work below is **not implemented** by these documents.

## Start here

- [Backlog](backlog/index.md): ordered work, status and dependencies.
- [Wiki schema](SCHEMA.md): source preservation, IDs, maintenance and closure rules.
- [Change log](log.md): dated documentation history.
- [D001 — Local avatar rendering and bounded display resources](decisions/D001-local-avatar-rendering.md): proposed architecture and reliability prerequisite.

## Specifications

- [S001 — Portable agent avatars](specs/S001-portable-agent-avatars.md): package, state transport, ownership, device adaptation and rollout; proposed.
- [S002 — Kiosk memory and lifecycle reliability](specs/S002-kiosk-memory-lifecycle.md): issue #20 investigation, bounded resources and soak acceptance; proposed.

## Work items

- [B001 — Kiosk memory growth](backlog/B001-kiosk-memory-growth.md): P1, ready for investigation; GitHub #20 remains open.
- [F001 — Avatar package and validation](backlog/F001-avatar-package.md): P2, proposed.
- [F002 — Avatar state and handoff](backlog/F002-avatar-state-handoff.md): P2, proposed.
- [F003 — Browser avatar renderer](backlog/F003-browser-avatar-renderer.md): P2, proposed; depends on B001, F001 and F002.
- [F004 — Additional display platforms](backlog/F004-platform-renderers.md): P3, proposed; later per-platform work.

## Sources

- [Issue #20 snapshot](raw/2026-11-06-issue-20.md): reporter's measurements and unconfirmed hypotheses.
- [User request notes](raw/2026-11-06-avatar-planning-request.md): requested portable avatar experience and documentation-only scope.
- [Reference notes](raw/2026-11-06-reference-notes.md): Karpathy wiki pattern and Muse local rendering, with primary links.
- [Code observations](raw/2026-11-06-display-code-observations.md): current display lifecycle at `c07c0e9`; static observations, not a leak diagnosis.

## Existing contracts and guides

- [Protocol v1](../../protocol/v1.md), [controller role](../../protocol/controller.md), [typed capabilities](../../protocol/capabilities.md), [outbound transport](../../protocol/reverse.md).
- [Controller SDK](../controller-sdk.md), [MacBook setup](../omarchy.md), [update/testing steps](../testing-upgrade.md), [agent tools](../agent-tools.md).
- [Integration notes](../integration.md), [historical Muse gap audit](../muse-gap-audit.md).

## Templates

- [Backlog item](templates/backlog-item.md).
- [Specification](templates/spec.md).
