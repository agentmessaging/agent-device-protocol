# B001 — Diagnose and bound kiosk memory growth

| Field | Value |
| --- | --- |
| Type / priority | Bug / P1 |
| Status | Ready for investigation; root cause unconfirmed |
| Owner | Unassigned |
| GitHub | [#20](https://github.com/23blocks-OS/agent-device-protocol/issues/20), open |
| Spec | [S002](../specs/S002-kiosk-memory-lifecycle.md) |
| Source | [Reporter snapshot](../raw/2026-11-06-issue-20.md), [code observations](../raw/2026-11-06-display-code-observations.md) |
| Dependencies | Target Omarchy access for final physical acceptance |

The browser reportedly reached about 3.2 GB after 6 h 39 min while the bridge remained responsive. The next step is to identify retained resources through the S002 workload matrix, then make the smallest demonstrated lifecycle correction. Speculative `revokeObjectURL` calls or a daily reload are not completion evidence.

## Scope and acceptance

- [ ] Capture environment, reproducible workload and JS/process/GPU/resource measurements; separate confirmed cause from hypotheses.
- [ ] Fix the demonstrated lifetime error with bounded pending work and explicit cleanup, preserving sensor indicators and local consent.
- [ ] Add regression coverage for that error, including disconnect/visibility/reassignment paths where relevant.
- [ ] Pass the S002 24-hour memory/responsiveness/safety criteria on the target or documented equivalent; attach sanitized before/after evidence.
- [ ] Link implementation PR, update this record and GitHub #20 together; track the 72-hour unattended rollout gate explicitly.

## Evidence and limits

Planning and static inspection only. No profile, soak, code fix or physical-device measurement was performed by this documentation task. This record remains open after the spec merge. Future branch suggestion: `fix/B001-kiosk-memory`.
