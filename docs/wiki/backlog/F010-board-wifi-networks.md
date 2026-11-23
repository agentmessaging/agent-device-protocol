# F010 — A board that joins the networks of the places it travels to

| Field | Value |
| --- | --- |
| Type / priority / status | Feature / P2 / in progress |
| Category | Mobile toy (Bruce) |
| Owner | Unassigned |
| GitHub | None (internal record) |
| Spec | None yet: device network setup needs a spec before code (it carries Wi-Fi passwords) |
| Sources | Owner request, 2026-11-23: "the toy will travel with the user, so I cannot have it connected to just a single wifi and flash it every time there is a new network"; "can we make the AI Maestro app set up the agent's networks for their devices?" |
| Dependencies | [F008](F008-esp32-eyes-and-ears.md) board; [F011](F011-controller-from-anywhere.md) (a new network does not reach a controller at a home address); AI Maestro app and agent settings (AI Maestro repository) |

## Problem and scope

Today the Wi-Fi name and password are built into the firmware (`ADP_WIFI_SSID`, `ADP_WIFI_PASSWORD`). A board inside a toy has no screen and no button, and it travels with its person: home, an office, a hotel, a phone hotspot. Reflashing for each network is not possible.

Included:

- The board keeps a list of networks in NVS (up to 8). At boot and after a lost connection it scans and joins the strongest known network.
- Two ways to add a network, both proposed for a spec:
  1. **From the controller, ahead of time.** While the board is connected (at home), the controller sends the agent's network list over the encrypted connection. This is a new typed capability, for example `network.set`, and needs the protocol first ([capabilities.md](../../../protocol/capabilities.md)): its args carry passwords, so it is allowed only through `/v1/secure` or Tailscale, never a plain home connection, and only with a local grant on the board.
  2. **From the owner's phone, on the spot.** When no known network is in range for about 30 seconds, the board opens a Bluetooth setup mode by itself (no button). The owner's AI Maestro app finds it and sends a network. Use Espressif's provisioning protocol (protocomm over BLE, security 2: SRP6a with a setup code) instead of a new format. The setup code is printed on a label inside the toy and kept by AI Maestro when the board is paired.
- A sign for setup mode (a slow blink), different from the capture and listening signs.
- The setup mode stops after 10 minutes and the board scans again, so it is never open for long.

Not included: Wi-Fi with captive portals (hotel login pages). A phone hotspot is the answer there.

## Evaluation (2026-11-23)

- Using the AI Maestro app instead of Espressif's app is right: the person already has it, it knows which agent and which board, and it can take the network from the agent's saved list instead of asking for the password again.
- The phone side needs Bluetooth in the app (a native module in React Native) and the ESP provisioning client. There are maintained React Native libraries for the Espressif protocol.
- On the board, Bluetooth (NimBLE) costs flash and RAM. The XIAO has room (4 MB app partition, 8 MB PSRAM). The stack can be freed after setup.
- Risk: Wi-Fi passwords in a controller message. The capability must be encrypted end to end, never logged, and the board must not return the passwords in any answer (only the network names).

## Acceptance

- [ ] Spec for device network setup (both ways), reviewed.
- [ ] Board: joins the strongest of several known networks; a lost network switches to another known one.
- [ ] Board: with no known network, setup mode starts by itself; the AI Maestro app adds a network; the board connects and the controller sees it.
- [ ] Board: a network list sent by the controller over `/v1/secure` is stored; the same request over a plain connection is refused.
- [ ] No password in logs (USB, UDP) or in any answer.

## Evidence and status history

2026-11-23: proposed after the first on-board tests of F008 and F009.

2026-11-23, branch `feat/esp32-networks`: S005 written; the SDK has the definitions (PR #59); the C core offers `network.*` only on the encrypted connection (host tests: 8 networks, a 9th replaces the least recently used, no password in any answer, nothing over a plain connection). On the board: up to 8 networks in the encrypted NVS (`NVS partition "nvs" is encrypted`), the Wi-Fi driver keeps no copy, the strongest known network is joined, a refused association is retried after 2 s, the list is erased when the controller key or agent changes. Through the test controller over `/v1/secure`: `network.list` → `{"networks":[{"ssid":"Pelamecha"}],"current":"Pelamecha"}`, add, an empty name refused, remove; the test password is in no log. Still open: joining a second real network (a phone hotspot), the Bluetooth setup mode, and the AI Maestro side (its F129).
