# S003 — Encrypted home network connection

| Field | Value |
| --- | --- |
| Status | Implemented in the SDK (F007); ESP32 pending (F008) |
| Date | 2026-11-22 |
| Owner | Unassigned |
| Work | [F007](../backlog/F007-encrypted-home-network-connection.md); consumer [F008](../backlog/F008-esp32-eyes-and-ears.md) |
| Sources | Owner request, 2026-11-22 (an ESP32 board as an agent's eyes and ears); [outbound profile, home network connections](../../../protocol/reverse.md#home-network-connections); [ESP32 client open question 1](../../../clients/embedded/esp32/README.md#open-protocol-questions) |

## Problem and evidence

A board that cannot run Tailscale may connect to its controller at a private IPv4 address ([reverse.md](../../../protocol/reverse.md#home-network-connections)). Nothing encrypts that connection, so the profile allows only `device.health`, `display.text` and `device.used` over it. A camera, a microphone (`audio` events), typed `input` and speaker output are refused. reverse.md says an encrypted connection keyed from the pinned keys is planned.

An ESP32-S3 board with a camera, a microphone and a speaker (Seeed XIAO ESP32-S3 Sense) cannot be an agent's eyes and ears until that encryption exists. The board already has libsodium (Ed25519) for the v1 signatures.

Observed facts:

- The outbound profile already carries messages up to 2,200,000 bytes. A JPEG snapshot (at most 1 MiB, about 1.4 MB as base64), an `audio` event (at most 640 KiB, about 0.9 MB) and a `speaker.play` request (at most 384 KiB) fit. The 16 KiB limit of the ESP32 client is a limit of its firmware, not of the protocol. A board with PSRAM can hold these messages. This spec does not add chunking.
- The reference listener binds only loopback and Tailscale addresses. A board on a home network cannot reach it today.

## Scope and compatibility

Included:

- A new connection path, `/v1/secure/DEVICE_KEY`, with a signed key exchange and encrypted WebSocket messages.
- The rule that a controller applies to an encrypted connection from a private address: the same as a Tailscale connection.
- The rule that a device configured for an encrypted connection never connects without it.

Not included:

- The HTTP media profile (live video and microphone streams). Live streams stay off for these connections.
- A device size limit field (ESP32 open question 2). It stays open.
- Discovery of the controller on the network. The device still uses the IPv4 address that its owner configured.

Compatibility: `/v1/connect/DEVICE_KEY` does not change. Existing devices and controllers work as before. A controller that does not implement this spec closes a `/v1/secure/...` connection before the upgrade (the reference hub does this for every unknown path). The device treats that as a temporary failure, reports it to its owner, and does not fall back to `/v1/connect`.

## Proposed behavior

All wire names in this section are proposed.

### Path and addresses

A device opens `ws://IPV4:PORT/v1/secure/DEVICE_KEY`. The address can be loopback, Tailscale or a private address (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`). Before the upgrade, the controller applies the same checks as for `/v1/connect` (unknown device, busy, `Origin`).

### Key exchange

All handshake messages are v1 wire packets (`seal`/`open`, domain `ai-maestro-device/1`), sent as WebSocket text messages. Keys come only from the operator's pins.

1. The controller makes a new X25519 key pair for this connection. It signs, with the agent's controller key:
   `{type:"secure.hello",version:1,id,challenge,to:deviceKey,ephemeral}`
   `id` and `challenge` are new 24-byte random hex values. `ephemeral` is the raw 32-byte X25519 public key, unpadded base64url.
2. The device verifies the packet with its pinned controller key. It checks `type`, `version`, `to` and the formats. It makes its own new X25519 key pair and signs, with its device key:
   `{type:"secure.accept",version:1,id,challenge,to:controllerKey,assignedAgent,ephemeral,peerEphemeral}`
   `id` and `challenge` are copied from the hello. `peerEphemeral` is the controller's `ephemeral`.
3. The controller verifies the packet with the pinned device key. It checks every correlation field, that `assignedAgent` is the pinned agent, and that `peerEphemeral` is its own ephemeral key. If `assignedAgent` names another agent, it closes with 4003 `not_owner`.

Both sides then compute:

- `shared = X25519(own ephemeral secret, peer ephemeral public)`. An all-zero result closes the connection.
- `transcript = SHA-256("adp-secure/1" || 0x00 || hello body bytes || accept body bytes)`, where the body bytes are the decoded `body` of each wire packet.
- `controllerToDevice = HKDF-SHA256(ikm = shared, salt = transcript, info = "adp-secure/1 controller-to-device", 32 bytes)`.
- `deviceToController = HKDF-SHA256(ikm = shared, salt = transcript, info = "adp-secure/1 device-to-controller", 32 bytes)`.

Each side deletes its ephemeral secret after this step. The key exchange must end within five seconds of the upgrade.

### Encrypted messages

After the key exchange, every message in both directions is a WebSocket binary message:

- The content is the UTF-8 JSON message that the outbound profile would send as text.
- It is encrypted with ChaCha20-Poly1305 (RFC 8439) and the key for its direction. The message is the ciphertext followed by the 16-byte tag. The additional data is empty.
- The nonce is four zero bytes followed by a 64-bit big-endian counter. Each direction starts its counter at 0 and adds 1 for each message.
- The receiver uses the next counter value it expects. A message that does not decrypt, a text message, or a decrypted message larger than 2,200,000 bytes closes the connection. Because the counter is implicit, a replayed, dropped, reordered or modified message also fails, and the connection closes.
- After 2^32 messages in one direction, the sender closes the connection. The device reconnects with a new key exchange.

WebSocket ping and pong frames are not encrypted. They carry no data.

### Inside the encrypted connection

The unchanged outbound profile runs inside, starting with the controller's `{type:"hello",challenge}`: authentication, the signed RPC transport, events, and approval receipts. All v1 signatures, pins, one-use challenges and limits still apply. The key exchange adds confidentiality and integrity against the network. It does not replace any v1 check.

### Limits by address

The controller decides by the address the connection came from, and by the path:

| Source address | `/v1/connect` | `/v1/secure` |
| --- | --- | --- |
| Loopback or Tailscale | Full outbound profile | Full outbound profile |
| Private (home network) | Home network limits of reverse.md: `device.health`, `display.text`, `device.used` only | Full outbound profile |

A device that has a camera, a microphone or a speaker, and that connects at a private address, MUST use `/v1/secure`. It MUST NOT connect to `/v1/connect` when its encrypted connection fails. This prevents a downgrade by someone on the network.

### Security properties

- Someone on the network cannot read or change what is sent, and cannot act as either side: each ephemeral key is signed with a pinned key.
- A recorded connection cannot be decrypted later, even with the long-term keys (forward secrecy): the keys come from ephemeral keys that are deleted.
- A replayed `secure.hello` gives the attacker nothing: the device makes a new ephemeral key, and the attacker does not have the controller's ephemeral secret. A replayed `secure.accept` does not match the controller's new challenge.
- Not hidden: the device key in the URL path, the controller's address, the time and size of messages, and that a device is in use. Anyone on the same network can see these.
- Someone on the network can still delay or drop messages. The heartbeat and call time limits of the outbound profile detect this.

### Why not TLS or Noise

TLS needs certificates or a pre-shared key setup that boards and controllers do not have. The pinned Ed25519 keys already exist on both sides. A signed X25519 exchange uses only primitives that both libsodium (on the board) and `node:crypto` (in the SDK) have: Ed25519, X25519, SHA-256, HMAC-SHA256 and ChaCha20-Poly1305 IETF. A Noise pattern would also work, but it needs a separate implementation on each side for the same result.

## Acceptance and rollout

SDK (simulated, on a computer):

- [x] `ReverseHub` accepts `/v1/secure/DEVICE_KEY` and `DeviceConnection` connects with `secure: true`. Discovery, invocation, `input`, `audio` and `device.used` work through the encrypted connection.
- [x] A modified, replayed, dropped or reordered encrypted message closes the connection. A text message after the key exchange closes the connection.
- [x] A handshake signed by an unpinned key, with a wrong `to`, a wrong `peerEphemeral` or another agent's address, is refused.
- [x] A connection from a private address to `/v1/connect` is limited as reverse.md says: other capabilities get signed `denied`; `input` and `audio` close the connection. The same device through `/v1/secure` has no such limit.
- [x] Test vectors: a fixed key exchange with known inputs gives known keys and a known first ciphertext, so other implementations can check against them.

ESP32 (host build of the C core, then a board):

- [x] The C core passes the same test vectors and connects to the SDK `ReverseHub` through `/v1/secure` (F008, host build).
- [ ] On a XIAO ESP32-S3 Sense: key exchange, health, text and a snapshot through a private address. Physical evidence is required for F008.

Rollout: opt-in. A controller accepts private addresses only when its operator turns it on and names the listening address. AI Maestro integration is tracked in the AI Maestro repository.

## Open decisions

- Should a controller also accept `/v1/secure` from Tailscale addresses only for testing, or as a normal path? This spec allows it; it costs nothing.
- Device size limit field (ESP32 open question 2): separate decision.
- Rekey for long connections: not needed while 2^32 messages and the reconnect rules apply.
