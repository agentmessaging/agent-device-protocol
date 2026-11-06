# B001 — Diagnose and bound kiosk memory growth

| Field | Value |
| --- | --- |
| Type / priority | Bug / P1 |
| Status | Ready for investigation; root cause unconfirmed |
| Owner | Unassigned |
| GitHub | [#20](https://github.com/agentmessaging/agent-device-protocol/issues/20), open |
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

## Measurements, 2026-11-06

Method: the real page with the real display server, in headless Chrome 155 on macOS, with activity published every three seconds and presence on. Sampled every 30 seconds through DevTools, with a forced collection on alternate samples. This is **not** the target device.

| Variant, 8 minutes | Renderer RSS | JS heap | Nodes | Layouts |
| --- | --- | --- | --- | --- |
| Current code | 116 MB, flat | 0.6 MB | 177 | 2,387 |
| No CSS animations | 114 MB, flat | 0.6 MB | 177 | 2,383 |
| Poll every 1 s | 111 MB, flat | 0.5 MB | 177 | 489 |
| One poll only | 96 MB, flat | 0.5 MB | 177 | 1 |

**The 9 MB per minute growth did not reproduce.** No retained JS heap, nodes or listeners grew, so the reported suspects (polling, animations, object URLs) are not confirmed as a leak of the page's own objects. The growth needs the target: Linux Chromium with a real display on the 2010 MacBook, under load. A headless Linux Chromium run hung on navigation and gave no data.

## Changes made

Each comes from S002's required behaviour or from the numbers above, not from a confirmed root cause:

- `/state` is compared with the last answer, and the page renders only on a change. Layouts over three minutes: 893 before, 62 after. This removes main-thread work on a slow machine, which fits the "Page unresponsive" report.
- At most one presence chain is pending, and control requests have a timeout. Before, a slow machine could start a new unbounded POST every 200 ms.
- While this issue is open, a kiosk reloads after six hours, only when nothing is in use: no live media, indicator, pending approval or typed text. This bounds the harm of any leak. It is a safety net, not a fix.

The 200 ms poll stays: the capture indicator's one-second acknowledgement depends on it.

Still needed: a profile on the target device, and the S002 24-hour run. This item stays open until then.
