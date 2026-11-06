# S001 — Portable agent avatars

| Field | Value |
| --- | --- |
| Status | Proposed; no implementation in this documentation change |
| Date | 2026-11-06 |
| Owner | Unassigned |
| Work | [F001](../backlog/F001-avatar-package.md), [F002](../backlog/F002-avatar-state-handoff.md), [F003](../backlog/F003-browser-avatar-renderer.md), [F004](../backlog/F004-platform-renderers.md) |
| Prerequisite | [B001](../backlog/B001-kiosk-memory-growth.md) reliability evidence before enabling avatars by default |
| Inputs | [User request](../raw/2026-11-06-avatar-planning-request.md), [Muse notes](../raw/2026-11-06-reference-notes.md), [D001](../decisions/D001-local-avatar-rendering.md) |

## Outcome and scope

Lola has a consistent visual identity on an assigned laptop, small display or later wearable. When the controller activates another device, that device presents Lola's current activity with locally rendered animation. The agent process remains on its host; only presentation state changes. Each device still has at most one locally approved owner, and each agent has at most one active device.

MVP: one reusable, data-only 2D avatar package format; a browser renderer for the existing Linux/Omarchy display; an optional authenticated state extension; and a deterministic fallback to the existing orb. Linux PCs and Raspberry Pi devices with a supported browser can share this renderer, but each hardware class requires its own verification. Small embedded/native renderers are later work, not implied support.

Out of scope: 3D models, video-rendered avatars, arbitrary HTML/JS/shaders, code generated and installed remotely, remote shell, automatic sensor permission, remote asset URLs, public avatar marketplace, lip-sync phonemes, and changing AI Maestro in this task. Creating final Lola artwork is separate from specifying its format.

## Architecture and ownership

| Layer | Responsibility |
| --- | --- |
| Controller | Associate agent identity with a package digest; send current activity/selection through the assigned signer; suppress output to idle devices |
| Protocol / SDK | Advertise the optional profile, validate bounded messages, preserve ownership/revision/replay rules, expose typed host APIs |
| Shared avatar package | Character identity, version, approved images, state-to-animation mapping and fallback portrait |
| Local renderer | Load one validated package, animate locally, adapt to available space and release resources |
| Device UI | Preserve local approval, stop/revoke, capture indicators, text input and PiP above the avatar layer |

Reusable rendering code belongs in a future shared presentation package, with thin platform adapters. Do not create a separate copy of character behavior for each board. A new operating system folder is not evidence of a functioning client. Source, packaging and display drivers can differ while following the same package/state contract.

## Avatar package v1 (proposed)

The MVP is an owner-installed directory or build-bundled package. Remote distribution is deferred: a controller can select an already approved digest but cannot upload executable content or cause an arbitrary download. A local installer validates before activation, installs atomically, retains at most one rollback version and bounds disk use. Missing packages fall back immediately; connecting a device must not wait on artwork.

Manifest fields and rules:

| Field | Rule |
| --- | --- |
| `schemaVersion` | Integer `1`; reject unknown versions |
| `avatarId` | Stable lowercase dotted/dashed identifier, 1–128 ASCII characters |
| `version` | Human version string, 1–32 ASCII characters; not a trust identifier |
| `displayName` | Plain text, up to 128 UTF-8 bytes; never interpreted as markup or identity proof |
| `license` | Plain text attribution/license identifier, up to 512 UTF-8 bytes |
| `logicalSize` | Integer width/height, 1–512; preserves aspect ratio |
| `assets` | Up to four static PNG atlases/portraits; relative basename, SHA-256, byte size and pixel dimensions |
| `poster` | Asset ID and bounded rectangle for static/reduced-motion fallback |
| `clips` | At most eight named states; each has up to 64 frame rectangles, each 50–2,000 ms, and boolean loop |

Allowed clip names: `idle`, `working`, `waiting`, `listening`, `speaking`, `unknown`, `disconnected`, `error`. `idle` and `poster` are required; missing optional clips use the poster/idle fallback plus a literal status label. Frame rectangles must stay within their atlas. No scripts, expressions, links, fonts, SVG, animated image decoders, shaders, event handlers, audio tracks or externally resolved resources.

Manifest maximum: 32 KiB UTF-8 JSON with duplicate keys rejected and no unknown fields. Total compressed assets: 2 MiB. Each asset: at most 1,024×1,024 pixels. Total decoded RGBA assets: 16 MiB, validated from actual image headers and decoded dimensions, not only claimed sizes. The renderer rejects packages exceeding its advertised lower budget. Corrupt PNGs, traversal, symlinks, unknown MIME types and hash mismatches fail before activation.

Package identity is the SHA-256 of the exact stored UTF-8 manifest bytes. The manifest includes hashes of every asset, making those bytes part of the identity transitively. Identical art with reformatted manifests can have distinct digests; no ambiguous JSON canonicalization is needed. Verify all asset hashes before switching. Bind the selected digest to the current local assignment revision. A digest verifies bytes, not licensing or owner approval.

On owner transfer/revoke, clear the former agent's selected package, active animations and content immediately. Validated public artwork may remain in a bounded disk cache but must not be displayed as the new agent until that owner selects and locally approves it. Display names never replace the verified full AMP address.

## Optional protocol profile (design contract, not current wire support)

Keep existing v1 `activity` messages unchanged. Current clients reject unknown fields, so do not insert avatar fields into those messages or send the new type to an old bridge. Add an optional signed registration property `presentation` for discovery:

```json
{
  "profiles": ["avatar/1"],
  "formats": ["png-atlas/1"],
  "maxPackageBytes": 2097152,
  "maxDecodedBytes": 16777216,
  "maxFps": 20,
  "viewport": {"width": 1280, "height": 800, "shape": "rectangle"},
  "reducedMotion": false
}
```

These fields describe actual local capacity, not ownership or a grant. Viewport dimensions are positive integers bounded to 8,192; shape is `rectangle` or `round`. Devices with a smaller limit advertise it. A text-only device omits this profile. Add a locally controlled `display.avatar` permission, off by default, separate from `display.image` and camera/microphone grants. The old orb and safety UI must work without it. Final SDK names and conformance fixtures are defined by F002 before promoting this proposal to `protocol/`.

Proposed signed `avatar.state` body (placeholders below are descriptive):

```json
{
  "type": "avatar.state",
  "id": "fresh-request-id",
  "challenge": "fresh-device-challenge",
  "to": "pinned-device-public-key",
  "assignedAgent": "lola@host.local",
  "revision": "current-device-assignment-revision",
  "bootId": "current-device-boot-id",
  "profile": "avatar/1",
  "packageDigest": "sha256-of-locally-approved-manifest",
  "state": "working",
  "active": true
}
```

Use the existing v1 Ed25519 signature domain, request ID and one-use challenge formats. Require the current assigned signer, exact agent, current revision and boot ID. Body maximum 4 KiB; reject unknown fields and invalid enum/type/length values. `packageDigest` is exactly 64 lowercase hex characters. `state` accepts `working`, `waiting`, `idle`, `unknown`; listening/speaking and sensor indicators derive locally from actual authorized media activity. `active` is boolean and remains controller information, not a device-enforced security boundary.

One latest state wins by the device's challenge issuance order, as with `activity`, across both message types. Superseded updates return 409 and cannot restore an older presentation. Fresh challenges are still required for retries. A correlated signed `avatar.ack` returns `applied` or `fallback` with bounded reason `missing_package`, `unsupported_package` or `local_resource_limit`; neither means a frame was physically viewed. Invalid authentication/revision/grant is denied and never changes the display. A fallback cannot be used to bypass a denial.

Transport: signed HTTP `/v1/request` first, and the same inner packet through the outbound RPC request path. No frame stream, new socket or cloud relay is required. Unsupported bridges receive existing `activity` messages only. An implementation must explicitly extend the outbound operation allowlist; current bridges do not already accept this type.

Rate: at most one update every 200 ms per device, burst one. Coalesce intermediate states and send the most recent; steady-state refresh about every three seconds. After 15 seconds without an accepted fresh state, show disconnected and stop presenting stale working/speaking activity. Use local monotonic age; no trusted remote wall clock. Reconnect performs discovery again and sends fresh current state, never queued animation history.

## Activation, reassignment and disappearance

For an agent jump, the controller atomically changes its active choice using the existing generation semantics, cancels old queued presentation updates and sends the new device the current package digest/state. Send an `active:false` observation to the old device when reachable; do not wait for it before activating the new one. An idle device shows its assignment with an idle marker/static portrait or fallback, not continuing agent output.

An unreachable old device can retain its last display until the 15-second freshness bound. There is no claim of instantaneous visual disappearance across a disconnected network. The existing one-active controller rule and local hardware grants remain distinct. Two different agents can each be active on their own device under one host controller; another agent cannot select or animate a device it does not own.

Ownership/revision change clears package selection, prior output, pending frame decodes and animation callbacks before new-owner rendering. Late asynchronous work carries a generation and is discarded on revision/package/visibility changes. A package load completing after a transfer must never redraw the previous owner.

## Rendering and form factors

The shared renderer maps semantic state to a local clip and animation clock. It does not need network messages for each blink or animation frame. One active animation loop per screen; frame rate capped at 20 fps for the first browser profile, reducing to a static image when hidden or reduced-motion is enabled. Audio-reactive motion is optional and uses local authorized playback/capture amplitude; it neither records nor transmits audio. Accurate phoneme lip sync is deferred.

| Surface | Presentation rule |
| --- | --- |
| Laptop / landscape browser | Fit character without stretching; retain readable activity and independent PiP/controls |
| Small square display | Prefer character plus short status; move secondary UI to explicit local controls |
| Round display | Fit essential character features and safety UI inside a declared safe area; no clipped indicators |
| Low-power / reduced-motion | Static poster and text; preserve identity and status even without animations |
| Missing/unsupported artwork | Existing orb plus verified agent name/address and status |

Character appearance is consistent, not necessarily pixel-identical across renderers. Package digest, state meaning, ownership behavior and fallback rules must agree. Platform profiles may use lower frame rates or a validated smaller asset variant with its own digest; they cannot silently claim support for an over-budget package.

Layer order: local consent/stop/capture indication above all avatar content; readable text/status above decoration; PiP independently toggleable. Animation failure cannot cover controls or leave a fake capture badge. Renderers never acknowledge the safety indicator before that indicator has actually been presented under the existing device checks.

Resource ownership follows [S002](S002-kiosk-memory-lifecycle.md): at most current package plus one bounded replacement during a switch, current frame plus one in-flight decode, explicit bitmap/URL disposal, no growing histories or accumulated animation callbacks. Total avatar decoded image/buffer budget for the browser is 24 MiB including a switch; if current plus replacement exceeds it, show the fallback, dispose the old package and then load the replacement. Disk cache target is 8 MiB with a maximum of current and one rollback package. Cache access is local, never a generic file-reading capability.

## Acceptance and delivery

1. F001 validates a reference package and rejects corrupt/oversized assets, unknown fields, paths, scripts and digest mismatches. A static fallback always works.
2. F002 tests signed current-owner state over HTTP and outbound RPC, old-client compatibility, grant denial, stale revision/boot/challenge rejection and update ordering. State alone cannot open camera or microphone.
3. F003 verifies the same package on 1,280×800, 320×320 and a simulated round viewport, plus one real Omarchy device. Round simulation does not qualify a physical watch.
4. Two agents/three devices: only the correct owner renders; jump invalidates old queued updates; an offline previous device degrades within the freshness bound; reassignment clears old presentation and grants.
5. Package switch, disconnect/reconnect, tab hide/show, reduced motion and renderer failure preserve controls and do not leak resources. Confirm local indicator behavior during active camera/microphone operations.
6. Pass B001/S002 memory criteria with avatars disabled, then repeat the target-device soak with avatars enabled. No daily reload used to pass the test. Attach actual measurements; do not substitute a screenshot for a soak.

Rollout: fallback remains default → explicit local avatar opt-in on Linux → measured pilot → later platforms each with their own backlog/PR and target-device evidence. Disabling the profile returns to the orb without changing ownership, transport or hardware grants. Keep packages locally removable and retain a bounded known-good version.

Open design decisions before implementation: final Lola artwork/license, concrete local installation UX, native/mobile framework choice and per-embedded-board memory budgets. These do not block investigating B001. Automatic avatar asset transfer is intentionally deferred; it needs a separate bounded data-transfer proposal and threat review, not `file.write` or shell access.
