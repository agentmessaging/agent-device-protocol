# S005 — Wi-Fi networks for a device that travels

| Field | Value |
| --- | --- |
| Status | Implemented in the SDK and on the XIAO ESP32-S3, the Bluetooth setup mode included (F010); a phone app is pending |
| Date | 2026-11-23 |
| Owner | Unassigned |
| Work | [F010](../backlog/F010-board-wifi-networks.md); related [F011](../backlog/F011-controller-from-anywhere.md), [S006](S006-public-relay.md) |
| Sources | Owner request, 2026-11-23: a board inside a toy travels with its person and must join new networks without a reflash; the AI Maestro app, not a second app, sets them up |

## Problem and evidence

A board's Wi-Fi network and password are built into its firmware. A board inside a toy has no screen and no button, and it goes wherever its person goes. Today a new network means a new build and a USB cable.

Observed facts:

- Capability arguments are a flat object of bounded strings, booleans and numbers. Arrays are not allowed ([capabilities.md](../../../protocol/capabilities.md)). A list of networks must be sent one network at a time.
- A plain home network connection carries only `device.health` and `display.text` ([reverse.md](../../../protocol/reverse.md#home-network-connections)). A Wi-Fi password can only travel over `/v1/secure` or Tailscale.
- Espressif publishes a provisioning protocol for Wi-Fi over Bluetooth LE (protocomm, with SRP6a "security 2" and a setup code), with client libraries for phones. Using it avoids a new local format.

## Scope and compatibility

Included: three typed capabilities, their local grant, what a device does with the networks, and a local setup mode that the owner's phone uses when the device has no known network.

Not included: networks with a login page (captive portals), enterprise Wi-Fi (802.1X), and how a controller stores the passwords (that is the controller's business; it must not store them in plain text).

Compatibility: new optional capabilities. Old controllers do not call them. Old devices do not declare them.

## Proposed behavior

### Capabilities

| Capability | Arguments | Result | Local grant | Activation |
| --- | --- | --- | --- | --- |
| network.add | `ssid`: 1–32 UTF-8 bytes; `password`: 0–63 UTF-8 bytes (empty for an open network) | `{stored:true, count}` | network | any |
| network.remove | `ssid`: 1–32 UTF-8 bytes | `{removed:boolean, count}` | network | any |
| network.list | empty object | `{networks:[{ssid}], current:ssid or null, setupCode?}` | network | any |

- A device keeps at most 8 networks. Adding a 9th replaces the one it joined least recently. Adding a name it already has replaces that network's password.
- A device MUST NOT return, log, display or send a password in any answer, event or log line, and MUST NOT keep it anywhere but its own encrypted storage. `network.list` returns names only.
- A controller MUST NOT invoke them over a plain home network connection (this already follows from the home network limits) or through a relay without `/v1/secure` ([S006](S006-public-relay.md)).
- Removing the network in use does not drop the connection. It takes effect the next time the device joins a network.

### The grant

The `network` grant is local and off by default. The owner turns it on at the device (a build option on a board). The local stop turns it off. A transfer erases every stored network: the old owner's passwords do not go to the new owner.

### Joining

At start and after a lost connection, the device scans and joins the known network with the strongest signal. If that fails, it tries the next one.

### Local setup mode

When the device finds none of its networks for 30 seconds, it opens a setup mode by itself:

- Bluetooth LE with Espressif's provisioning protocol, security 2 (SRP6a). The setup code is at least 8 characters, made by the device at first start, kept in its encrypted storage, and printed on the device's label or USB console by its owner. A device with no setup code does not offer the setup mode.
- A sign different from the capture and listening signs, for example a slow blink.
- A network received this way is stored as if it came from `network.add`.
- The mode ends after 10 minutes, or when a network works. The device then scans again.

The setup mode is local, like the talk control: it is not part of the wire protocol, and a controller cannot open it.

## Acceptance and rollout

Required evidence:

- SDK: definitions and argument checks for the three capabilities; the controller refuses to invoke them over a plain home network connection.
- Board: joins the strongest of two known networks; when one goes away it joins the other; a network added with `network.add` over `/v1/secure` is used after a restart; `network.list` and the logs contain no password; the setup mode starts with no known network and accepts a network from a phone.

Rollout: off by default. When an implementation passes, the capabilities move to [capabilities.md](../../../protocol/capabilities.md).

## Decisions

- 2026-11-23, owner: the controller may read the setup code. `network.list` returns it as `setupCode` when the device has a setup mode, over the encrypted connection only, so the owner's app can open the setup mode with no label on the device. The code is then in one more place (the controller); a new owner gets a new code. The Wi-Fi password is never sent back: the person types it on the phone.
