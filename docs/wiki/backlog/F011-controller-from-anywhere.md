# F011 — Reach the controller from anywhere through a public tunnel

| Field | Value |
| --- | --- |
| Type / priority / status | Feature / P2 / in progress |
| Category | Mobile toy (Bruce) |
| Owner | Unassigned |
| GitHub | None (internal record) |
| Spec | Needs a spec change: [S003](../specs/S003-encrypted-home-network-connection.md) allows `/v1/secure` from loopback, Tailscale and private addresses only |
| Sources | Owner decision, 2026-11-23: "the Cloudflare tunnel is an awesome idea so the toy can work in any place" |
| Dependencies | [F010](F010-board-wifi-networks.md); AI Maestro tunnel setup (AI Maestro repository) |

## Problem and scope

The board connects to its controller at a home address (`ws://10.0.0.223:23112`). On any other network that address does not exist. Boards cannot run Tailscale. To work in any place, the board needs an address on the internet.

Proposal: the controller's device port is published through a Cloudflare tunnel at a public host name, for example `wss://devices.example.com`. The board connects with TLS to that name and opens `/v1/secure/DEVICE_KEY` inside it. The S003 key exchange and encryption still run end to end with the pinned keys, so Cloudflare carries only encrypted frames.

## What the spec must settle

- **The tunnel hides the real address.** `cloudflared` connects to the controller from loopback, and S003 treats loopback like Tailscale. A tunnel connection must not get loopback trust:
  - the controller accepts only `/v1/secure` on the tunnel's local port (a separate listener), never `/v1/connect`;
  - or it detects the tunnel (Cloudflare headers, a dedicated port) and treats the connection as public.

  Without this, a plain `/v1/connect` through the tunnel would get the full profile with no encryption.
- **Board side:** `wss://` with certificate checks (ESP-IDF certificate bundle). The firmware check that the controller URL is a private address (`private_url`) changes to: a private `ws://` address, or a `wss://` name.
- **Public exposure:** the tunnel publishes only the device endpoint (`/v1/secure`), not the AI Maestro dashboard. Unknown device keys are refused before the upgrade, as today. Rate limits at Cloudflare.
- **Same board, two addresses:** at home it may use the home address, which is faster. Away, it uses the tunnel. The order is a list in the board's settings, or a list the controller sends with F010.

## Acceptance

- [ ] Spec change reviewed (S003 amendment or a new spec).
- [ ] SDK: `/v1/connect` through the tunnel is refused; `/v1/secure` works.
- [ ] Board on a phone hotspot: connects through the tunnel, health, a snapshot, a spoken sentence, a talk clip.
- [ ] Packet check: only TLS to Cloudflare leaves the board.

## Evidence and status history

2026-11-23: proposed. The owner chose the Cloudflare tunnel; the AI Maestro meeting room already uses one (port 23100 only).

2026-11-23: S006 written and the SDK has `ReverseHub({ relay: true })` (PR #59). On the board (`feat/esp32-networks`, `ADP_RELAY_URL`), with a dead home address and a Cloudflare quick tunnel to a relay hub on the Mac: the home address failed, the board connected at once to `wss://….trycloudflare.com` with certificate checks, the S003 key exchange ran inside, and the full profile worked: discovery, a chime, 315 KB of speech in 407 ms, and a talk clip transcribed as "Hey, Bruce, can you hear me through the tunnel?". Still open: a network with no route home (a phone hotspot), and the AI Maestro relay listener (its F130).
