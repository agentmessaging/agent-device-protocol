# Typed capabilities, owner extensions and local indicators

A signed `register` advertises `capabilities` and `capabilityDefinitions`. Each definition declares `activation` (`active` or `any`) and an `args` schema. `invoke` adds optional `args`; omission means `{}`. Unknown fields, missing required fields, wrong types and oversized arguments return signed `invalid_arguments`. A controller MUST reject undeclared operations and enforce the active-device rule before sending sensors or output.

Schemas use a bounded subset: a flat object, at most 16 properties, an explicit required list, and `additionalProperties:false`. Custom arguments may be strings with a required UTF-8 byte bound up to 4096, booleans, or finite numbers/integers with explicit minimum and maximum. A string enum contains 1–32 bounded strings. Nested objects, arrays, arbitrary schema references and code are not supported. Built-in image data has its separately specified larger bound.

| Capability | Arguments | Local grant | Activation |
| --- | --- | --- | --- |
| device.health | empty object | ownership | any |
| camera.snapshot | empty object | camera and working visible indicator | active |
| display.text | text, up to 4096 UTF-8 bytes | display.text | active |
| display.image | mime (image/jpeg or image/png), standard base64 data, decoded maximum 256 KiB | display.image | active |
| speaker.say | text, up to 500 UTF-8 bytes | speaker.say | active |

Text is literal text, never HTML or markup. Images must have the declared PNG/JPEG signature; SVG, URLs and file paths are refused. Output grants default off. The display retains output for up to sixty seconds and clears it on assignment/grant revision changes. Speech uses the optional fixed Linux `/usr/bin/espeak-ng --stdin` adapter, with a ten-second bound; unsupported speech hardware is not advertised. Transfer resets all output and custom grants. A controller cannot install, change or remove a handler through this protocol.

## Owner-defined capabilities

Names have the form `custom.OWNER.ACTION`, with lowercase letter-first namespace/action segments of up to 32 letters, digits, underscores or hyphens. They cannot collide with protocol capabilities. Each local definition declares name, description (up to 256 UTF-8 bytes), a boolean sensor classification, activation, bounded args, a 100–10,000 ms timeout and a locally selected handler. Sensors MUST require active selection. Other owner actions declare whether activation is required.

The reference Linux loader reads JSON definitions and `.mjs` handler modules from `ADP_HOME/capabilities`. Both files and their directory must belong to the device's OS user and must not be symlinks or group/world writable. Modules export `handle(args)`. Only a basename is permitted in the local module field. The module path is never accepted from a network invocation. A child process runs the fixed installed handler, with bounded validated input, a 32 KiB JSON result limit, cancellation and a timeout that terminates its process group. At most four handlers run concurrently. These are trusted programs installed by the device owner, not a code sandbox; owners must write fixed actions and must not interpret argument strings as shell commands.

Every custom capability has an explicit local grant, off by default. Unsafe or invalid definitions are not advertised. Custom camera/microphone handlers must satisfy the indicator requirement below; declaring a custom namespace does not waive it.

## Visible capture indication

A device with a camera or microphone MUST show a device-driven sign visible to people nearby whenever it captures or streams. A hardware light tied to sensor power is preferred; a visible local screen sign is the minimum. A bridge that cannot establish a working indicator MUST NOT advertise or invoke the affected capture capability. A controller cannot disable or acknowledge that sign remotely.

For snapshots, the sign MUST appear before capture and remain for at least three seconds after its display acknowledgment. Streaming indication lasts throughout capture, with at least the same initial minimum. Local grants and the local stop control remain authoritative regardless of controller deployment or active-device state.

The Linux screen sends same-origin, token-protected visibility/paint acknowledgments. The bridge waits for the rendered sign before starting capture. The browser must be visible and continue acknowledging; a hidden, closed or unresponsive screen removes capture availability and cancels capture within approximately 1.1 seconds (one-second freshness bound plus a 100 ms check). The camera's own hardware light is used naturally where the driver powers it, but the reference bridge does not assume an undetectable light is working. Keep the screen open and visible when testing camera or microphone.
