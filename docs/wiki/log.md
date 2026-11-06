# Wiki change log

Append new entries; preserve prior history. Dates use America/Denver.

## [2026-11-06] ingest | Avatar planning and kiosk report

Established the repository wiki, schema, navigation and templates. Captured [issue #20](raw/2026-11-06-issue-20.md), [user request](raw/2026-11-06-avatar-planning-request.md), [reference notes](raw/2026-11-06-reference-notes.md) and [static code observations](raw/2026-11-06-display-code-observations.md).

Added proposed [S001](specs/S001-portable-agent-avatars.md), [S002](specs/S002-kiosk-memory-lifecycle.md), [D001](decisions/D001-local-avatar-rendering.md), and the [backlog](backlog/index.md). B001 is the immediate reliability priority; avatar implementation is future work. No runtime code, dependency, service, hardware permission or deployed device changed. Issue #20 is not resolved by writing this plan.

## [2026-11-06] lint | Initial documentation review

Checked all 20 Markdown files in this change, 104 local Markdown links, index coverage and whitespace. All local targets exist and each wiki page is indexed. Confirmed all changes are Markdown, proposed features remain labelled unimplemented, B001 remains open, and the implemented protocol files are unchanged. Runtime tests and a physical-device soak were not performed for this documentation-only change.

## [2026-11-06] fix | Kiosk lifecycle bounds

Measured the display page: no leak reproduced in headless Chrome on macOS. Bounded presence and control requests, skipped rendering of unchanged state, and added a six-hour idle reload as a safety net. See [B001](backlog/B001-kiosk-memory-growth.md). Issue #20 stays open for target-device evidence.
