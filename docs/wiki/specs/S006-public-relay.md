# S006 — Connecting to the controller through a public relay

| Field | Value |
| --- | --- |
| Status | Proposed |
| Date | 2026-11-23 |
| Owner | Unassigned |
| Work | [F011](../backlog/F011-controller-from-anywhere.md); related [S003](S003-encrypted-home-network-connection.md), [S005](S005-device-networks.md) |
| Sources | Owner decision, 2026-11-23: a Cloudflare tunnel so a toy works in any place |

## Problem and evidence

A board that travels joins networks where its controller's home or Tailscale address does not exist, and the board cannot run Tailscale. [reverse.md](../../../protocol/reverse.md) puts "public origins, DNS names, redirects and cloud relays" outside the profile.

Observed facts:

- A tunnel such as Cloudflare Tunnel connects to the controller from the controller's own machine. The controller sees loopback, and S003 treats loopback like Tailscale. A tunnel to the usual port would give a stranger on the internet the trust of a local process.
- S003 does not depend on the network for confidentiality or integrity: its key exchange is signed with the pinned keys. Inside a relay it still protects every message.

## Scope and compatibility

Included: a device URL form for a relay, the rules a controller applies to relayed connections, and the device's list of controller addresses.

Not included: running a relay, and hiding the device key, addresses and timing from the relay.

Compatibility: optional on both sides. A controller without a relay listener changes nothing.

## Proposed behavior

### Device

- A device MAY connect to `wss://HOST[:PORT]/v1/secure/DEVICE_KEY`, where `HOST` is a DNS name. It checks the TLS certificate against public roots. TLS is not the trust: the S003 key exchange with the pinned controller key is still required before anything else.
- Through a relay a device uses `/v1/secure` only, never `/v1/connect`, and never falls back.
- A device MAY keep an ordered list of controller addresses (for example its home address first, a relay second). It tries them in order on each connection attempt, with the usual backoff after the whole list fails. Every address is for the same controller and the same pinned key.

### Controller

- A controller that accepts relayed connections serves them on a separate listener used only by the relay (for example a loopback port that only the tunnel connects to). On that listener:
  - only `/v1/secure/DEVICE_KEY` is accepted; `/v1/connect` is refused with HTTP 403 before the upgrade;
  - the connection's address is not used for trust: no loopback, Tailscale or home network rule applies, even though the relay connects from loopback;
  - the usual checks before the upgrade apply (unknown device, busy, `Origin`).
- After the S003 key exchange a relayed connection carries the full profile, the same as an encrypted home network connection.
- The relay listener is off by default. The operator turns it on and names the public host name that devices use.

### What the relay sees

The relay sees the device key in the path, both public addresses, and the timing and size of messages. It cannot read or change messages without breaking the S003 encryption, which closes the connection. It can drop or delay them.

## Acceptance and rollout

Required evidence:

- SDK: a relay listener refuses `/v1/connect` and accepts `/v1/secure`; a connection on it is not treated as loopback.
- Board: on a network with no route home (a phone hotspot), the board connects through the relay, answers health, plays speech and sends a talk clip; a packet capture shows only TLS to the relay.

Rollout: opt-in on the controller. When an implementation passes, reverse.md gets a "Relayed connections" section.
