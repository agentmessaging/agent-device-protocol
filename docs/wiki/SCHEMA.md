# Repository wiki schema

This is a small adaptation of [Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f): immutable source records, a maintained Markdown knowledge layer, an index and an append-only log. The backlog conventions below are this project's choices, not a prescribed Karpathy issue system. Everything is versioned in this repository; no separate GitHub Wiki, database or Obsidian plugin is required.

## Where information lives

| Location | Purpose and authority |
| --- | --- |
| `raw/` | Dated source snapshots or explicitly labelled source notes; immutable after ingestion |
| `index.md` | Navigation to every maintained page and source record |
| `backlog/` | Canonical internal work items and their status; GitHub issues are linked external reports/discussion |
| `specs/` | Proposed behavior and measurable acceptance criteria; not evidence of shipment |
| `decisions/` | Decisions, rationale, alternatives and consequences |
| `templates/` | Formats for new work items and specs |
| `log.md` | Append-only dated ingestion, decision, validation and status entries |
| Repository-root `protocol/` | The shipped contract; use the index links to reach it |
| Existing `docs/*.md` | Operator/integration guides remain in place; link rather than copy |

## Records and status

Use stable IDs: `B001` for a bug, `F001` for a feature, `S001` for a spec and `D001` for a decision. Never reuse or renumber an ID after publication. Allocate the next available ID from the index; reconcile concurrent allocations before merging. Filenames begin with that ID. Internal IDs are independent of GitHub issue numbers.

Backlog records contain title, type, status, priority, owner, source/GitHub links, spec, dependencies, scope, acceptance and evidence. Priorities: P0 immediate safety/outage; P1 reliability blocker; P2 planned capability; P3 later platform expansion. `Unassigned` is an honest owner value, not an implicit assignment to another team.

Backlog states: `proposed` → `ready` → `in-progress` → `done`, with `blocked` or `cancelled` where justified. `Ready` means the next bounded work step is defined; a ready investigation does not imply its root cause is known. For blocked items name the blocker. For done items link implementation and verification. Cancelled items retain rationale and replacement links. Do not mark an implementation done because its spec was merged.

Spec states: `draft`, `proposed`, `accepted`, `implemented`, `superseded`. Proposed numeric budgets and wire fields are design targets, not measured facts. Spec acceptance settles the design; implementation still needs its own PR and evidence. Decisions use `proposed`, `accepted`, `superseded`. Date entries in America/Denver and preserve timestamps supplied by external sources as supplied.

## Workflow

1. Read the index and matching records; check for existing GitHub reports before creating duplicates.
2. Ingest the source once. Record URL, retrieval date, revision/commit when available, provenance, and whether it is a quote, snapshot or summary. Avoid copying third-party articles; retain concise notes with links. Never store keys, tokens, personal media or unsanitized heap dumps in Git.
3. Update the relevant spec/backlog with evidence, explicit unknowns and cross-references. New evidence that conflicts with an earlier source gets a new record and an explanation; do not rewrite the old snapshot.
4. Update index summaries/status and append a log entry in the same PR. Keep changes to shared indexes sequential to reduce conflicts.
5. Review local Markdown targets, unique IDs, orphan pages, contradictions, stale implementation claims and unresolved dependencies. A docs-only change needs this review, not invented runtime test results.
6. Implement in a separate issue-specific branch when requested. Link GitHub reports to the internal ID; use `Refs #20` for planning and reserve automatic issue-closing keywords for an actual verified fix.
7. On completion, update the record, index and evidence. Report remaining downstream work by link. If GitHub and Git status disagree, investigate and reconcile; do not silently choose the more optimistic status.

The index and ordinary text search are sufficient initially. Automation, embeddings, a new app and a mass import of previously closed issues are outside this setup.
