# F001 — Define and validate portable avatar packages

| Field | Value |
| --- | --- |
| Type / priority / status | Feature / P2 / Proposed |
| Owner | Unassigned |
| GitHub | None; this is the internal issue |
| Spec | [S001](../specs/S001-portable-agent-avatars.md), package section |
| Sources | [User request](../raw/2026-11-06-avatar-planning-request.md), [reference notes](../raw/2026-11-06-reference-notes.md) |
| Dependencies | Accept S001 package format and settle reference artwork licensing |

Implement a reusable schema/validator and local installation contract for a data-only character package. Preserve identity and clip meanings across renderers without requiring copied renderer implementations. This item does not deliver a remote asset downloader or enable avatars on devices.

- [ ] Validate manifest version, digests, bounded PNG dimensions/decoded memory, frame rectangles and state mappings.
- [ ] Reject unknown fields, executable/remote content, traversal, symlinks, corrupt images and hash mismatches.
- [ ] Define atomic install, local approval, assignment-scoped selection and bounded rollback/cache behavior.
- [ ] Supply a rights-cleared synthetic reference package with poster and fallback fixtures; final Lola artwork is not assumed approved.
- [ ] Publish types and malformed/valid package tests; keep shipped/proposed documentation accurate.

Evidence: design only. Future branch: `feat/F001-avatar-package`. [Backlog](index.md).
