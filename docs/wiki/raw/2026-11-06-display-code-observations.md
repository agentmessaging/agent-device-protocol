# Source note: current display lifecycle

- Inspected: 2026-11-06.
- Revision: `c07c0e922de261ed3409a5b6b496000c6db9cb17`.
- Method: static read only; no heap profile, hardware reproduction or measured root cause.
- Sources: [screen.js](https://github.com/23blocks-OS/ai-maestro-device-protocol/blob/c07c0e922de261ed3409a5b6b496000c6db9cb17/apps/display/screen.js), [server.mjs](https://github.com/23blocks-OS/ai-maestro-device-protocol/blob/c07c0e922de261ed3409a5b6b496000c6db9cb17/apps/display/server.mjs), [browser smoke test](https://github.com/23blocks-OS/ai-maestro-device-protocol/blob/c07c0e922de261ed3409a5b6b496000c6db9cb17/tests/browser-smoke.mjs).

The browser polls `/state` through a completion-scheduled timeout, uses a two-second fetch timeout, then waits 200 ms. Visible polls schedule nested animation-frame callbacks to acknowledge the capture indicator; these initiate a separate control request. Visibility changes also initiate presence requests. Pending animation callbacks and control requests need measurement under suspension and slow responses; this is a hypothesis, not a confirmed leak.

The camera image element uses timestamped same-origin `/frame/...` URLs, not a browser-created Blob URL in the inspected path. The server retains one current frame and applies a sixty-second age bound. It marks HTTP responses `no-store`. These facts do not establish bounded browser decoded-image or GPU memory. Adding `revokeObjectURL` without finding a created object URL would not address demonstrated behavior.

`/state` serializes the current output object, which can include base64 image data, even though the browser also uses `/output/...` to display that image. Repeated payload allocation is worth measuring, but does not by itself prove retention. Listeners are assigned during startup; no obvious append-only history is visible in this file.

The short browser smoke check verifies rendered content, not hours-long memory behavior. The display's capture acknowledgement expires after one second, and snapshots require a visible indicator. A proposed lifecycle fix must preserve those bounds rather than keeping capture alive when the page is hidden or unresponsive.
