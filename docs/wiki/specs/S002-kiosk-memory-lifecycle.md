# S002 — Kiosk memory and lifecycle reliability

| Field | Value |
| --- | --- |
| Status | Proposed investigation and acceptance plan; bug not fixed |
| Date | 2026-11-06 |
| Owner | Unassigned |
| Work | [B001](../backlog/B001-kiosk-memory-growth.md) |
| External report | [GitHub #20](https://github.com/23blocks-OS/ai-maestro-device-protocol/issues/20) |
| Evidence | [Issue snapshot](../raw/2026-11-06-issue-20.md), [static observations](../raw/2026-11-06-display-code-observations.md) |
| Consumer | [S001 avatar renderer](S001-portable-agent-avatars.md) must satisfy these lifecycle requirements |

## Problem and evidence boundary

The reporter observed approximately 3.2 GB in the Chromium renderer after 6 h 39 min on an Omarchy laptop with 7.6 GB RAM. Free RAM fell to 210 MB; the kiosk became unresponsive. The bridge's `/state` still returned HTTP 200 in 17 ms. Restarting Chromium restored substantially lower memory use. The report covers `ffdda4d` and `c07c0e9` and includes snapshot PiP and regularly published activity.

This is strong evidence of a browser-side resource problem, not a confirmed JavaScript leak or a confirmed root cause. No heap profile was attached. Distinguish JS heap, decoded image/GPU memory, renderer process RSS, browser/network process memory and bridge RSS. Browser garbage collection and shared memory can make a single RSS sample misleading.

Current code uses same-origin image URLs and a latest-frame server slot; it does not create Blob URLs in the inspected camera path. `/state` output-image payloads, animation-frame scheduling, presence requests, image replacement and compositor allocations are investigation targets. Do not assert that any one caused the incident without before/after evidence.

## Investigation plan

Record OS/kernel, Chromium version/flags, display resolution/scale, GPU driver/acceleration, Node version, exact commit, package lock, frame dimensions/rate and publishing interval. Use a dedicated kiosk profile as in the report. First run with the reporter's configuration; controlled fresh-profile and GPU-disabled comparisons may help isolate behavior, but must not replace the original-condition test.

Start with 30–60 minute controlled cases, after a 15-minute warm-up:

| Case | Workload and question |
| --- | --- |
| Idle | No capture/output; activity every three seconds. Does animation/polling alone grow memory? |
| Snapshot PiP | Synthetic JPEG every five seconds, then stop. Are prior images/requests released? |
| Live video | Repeated locally permitted 60-second sessions at the supported 5 fps with five-second gaps; does decode/GPU memory plateau? |
| Output image | One bounded image repeatedly observed through `/state`, then replacement/expiry. Is data copied or retained unnecessarily? |
| Lifecycle stress | Hide/show 100 times, bridge disconnect/reconnect 100 times, PiP expand/collapse, package switches when available. Are callbacks and references bounded? |
| Slow/error paths | Delayed or hung state/presence/image responses, failed decode, owner transfer and grant revocation. Does pending work cancel? |

Use synthetic media for repeatable automated tests. Real camera/microphone sessions require local consent and their normal visible indicator; profiling never bypasses this. Do not store private frames, tokens or raw heap dumps in the repository. Heap files can contain user input and media; keep them restricted and publish sanitized measurements/retainer summaries.

Collect per-minute OS process metrics and, where available, Chromium DevTools Protocol heap/DOM/listener counters. Take comparative heap snapshots at stable points, inspect retaining paths, pending animation callbacks, network requests and image/GPU allocation. `performance.memory` is optional diagnostics, not a portable production requirement. Forced GC is useful for comparing retained heap, but primary soak metrics must reflect normal operation without it.

Stop an unsafe reproduction before exhausting the device (proposed guard: renderer RSS above 1 GiB or available RAM below 1 GiB). Preserve samples and mark the run failed; do not silently restart and treat the next process as the same run. Keep an SSH/terminal recovery path and the documented manual kiosk restart workaround available.

## Required behavior of the eventual fix

- One state request in flight and one scheduled next poll. Every network operation, including local presence/control requests, has a finite timeout and bounded concurrency. Coalesce replaceable observations instead of queuing them.
- No more than one pending presence acknowledgement chain. Hidden/suspended pages cancel decorative callbacks and obsolete work. Resume starts one loop from current state, not a backlog. Retain the existing indicator acknowledgement deadline; do not weaken it to hide lifecycle bugs.
- One current camera image and at most one in-flight replacement; discard superseded work using an ownership/render generation. Release image bitmaps and object URLs if the chosen implementation creates them. Reusing a URL does not by itself prove browser decoder memory is bounded.
- UI state should contain small metadata/reference fields rather than repeatedly transporting binary image content when the separate image endpoint is sufficient. Any local API change must be specified and tested for existing display behavior; this is a candidate optimization, not a preselected leak fix.
- No unbounded state/event/history lists, detached DOM nodes, listeners, timers, animation objects or caches. Bind lifecycle ownership explicitly and dispose on teardown, package change and reassignment.
- Loss of the local screen or its acknowledgement stops capture under the existing device rules. Hidden/unresponsive pages must never fabricate heartbeat/indicator success. Clearing stale resources must not clear an active safety indicator before capture has actually stopped.
- Renderer failure falls back to an intelligible status and usable stop/consent controls when possible. The bridge remains independently reachable. Recovery cannot grant a permission or replay a capture.

Do not precommit to replacing polling with SSE, removing the orb, disabling all GPU acceleration or changing the protocol. Choose the smallest correction supported by profiling. No remote wire change is required merely to fix local display resource lifetime.

## Acceptance targets (proposed, to measure)

Use the target Omarchy hardware or document a clearly identified equivalent, plus a Linux Chromium automation run. These are initial budgets, not claims about current measurements. If evidence requires a different bound, update the spec with rationale before calling the work complete; do not relax thresholds silently after a failing run.

| Measure | Initial target after warm-up |
| --- | --- |
| Retained JS heap | At most 64 MiB; same-workload endpoint comparison after diagnostic GC grows at most 8 MiB |
| Target page renderer RSS | At most 512 MiB; document process attribution rather than counting all Chrome processes as one page |
| Growth | Difference between the first and final hour medians at most 32 MiB, and fitted hourly-median slope at most 1 MiB/hour in the 24-hour run |
| DOM/listeners | Stable counts within a documented fixed bound; no growth proportional to snapshots, polls or visibility toggles |
| Pending work | State fetch ≤1, presence exchange ≤1, image decode ≤1 replacement; no suspended callback backlog |
| Responsiveness | No unresponsive-page dialog; synthetic local stop/control interactions acknowledge within one second in ≥99% of samples |
| Safety | Existing visible-indicator, revoke, transfer, disconnect and bounded-media tests pass without relaxed timing/permission rules |

Run a 24-hour mixed-workload soak: repeat idle, snapshot, live-video and output-image blocks; interleave disconnect/visibility transitions and maintain the original activity cadence. Include at least eight continuous hours with snapshot PiP to exceed the reported failure window. Run without automatic reload, process restart or forced GC for the primary memory-growth results. Repeat a 72-hour pilot before recommending permanent unattended rollout. If access to the physical device is unavailable, mark that acceptance blocked; do not claim synthetic CI completed it.

For avatars, run the same acceptance first without avatars and then with the proposed renderer and package switching. The package memory budget does not replace total page/RSS limits.

## Evidence, closure and rollout

B001 completion requires: reproducible workload or defensible retained-resource evidence, before/after measurements on the same configuration, implementation PR, regression coverage for the demonstrated lifetime error, and the 24-hour acceptance record. Keep an acceptance summary in this wiki with timestamp, revision, environment, workload, sample counts, peaks/slopes, pass/fail and links to sanitized artifacts. If no cause is found, retain `in-progress`/`blocked` with findings rather than claiming a workaround fixes the bug.

A 72-hour pilot is the rollout gate and may be tracked separately after the verified fix. Update GitHub #20 and B001 together when the fix acceptance is met; these planning documents do not close it. A new integration problem after closure should be a new specific report.

Manual kiosk restart remains an operator workaround. A scheduled daily reload or heap-triggered refresh may be evaluated later as explicit local recovery, but cannot substitute for bounded resource ownership or be used to pass this acceptance. Never auto-reload during capture, consent decisions or unsent input. A rollout rollback restores the previous display build without changing agent identity or grants; stop capture before replacing a screen that provides its safety indicator.
