# Device-initiated connection profile

This extends [v1](v1.md). An owned device opens a WebSocket directly to its controller at `ws://TAILNET_IPV4:PORT/v1/connect/DEVICE_KEY`. Loopback is also allowed for local tests, and a private network address for devices that cannot join a tailnet (see [Home network connections](#home-network-connections)). Public origins, DNS names, redirects and cloud relays are outside this profile. Tailscale supplies encryption; every authority-bearing message still uses the v1 Ed25519 domain and pinned keys.

A controller refuses a connection whose `Origin` is a web page's. It accepts no `Origin`, and its own origin: phone socket libraries always send the origin of the address they connect to, and cannot remove it.

## Home network connections

Some devices, such as microcontroller boards, cannot run Tailscale. Such a device MAY connect to its controller at a private IPv4 address (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`). A controller MAY accept these connections; it is not required to.

Nothing encrypts this connection. The signatures, pinned keys and one-use challenges still apply, so no one on the network can act as the controller or the device, or replay a request. But anyone on the same network can read what is sent, and can delay or drop it. A device also cannot tell its owner's network from another network that uses the same addresses.

So a home network connection carries only data that is safe to read:

- The controller MUST NOT invoke any capability except `device.health` and `display.text` over it. Anything else, such as a microphone, camera, snapshot, speech or image, is refused with signed `denied`.
- The controller MUST refuse `input` and `audio` events over it, and close the connection. `device.used` is allowed.
- The controller decides by the address the connection came from, not by what the device claims.

These limits apply to every plain connection (`/v1/connect`) from a private address. An [encrypted home network connection](#encrypted-home-network-connection) (`/v1/secure`) has no such limit.

## Encrypted home network connection

A device that cannot run Tailscale and has a camera, a microphone or a speaker connects to `ws://IPV4:PORT/v1/secure/DEVICE_KEY` instead. The address can be loopback, Tailscale or private. Before the upgrade the controller applies the same checks as for `/v1/connect`.

1. The controller makes a new X25519 key pair for the connection and sends a wire packet signed with the agent's controller key: `{type:"secure.hello",version:1,id,challenge,to:deviceKey,ephemeral}`. `id` and `challenge` are fresh 24-byte random hex values; `ephemeral` is the raw 32-byte X25519 public key, unpadded base64url.
2. The device verifies it with its pinned controller key, makes its own X25519 key pair and answers, signed with its device key: `{type:"secure.accept",version:1,id,challenge,to:controllerKey,assignedAgent,ephemeral,peerEphemeral}`, with `id` and `challenge` copied and `peerEphemeral` set to the controller's `ephemeral`.
3. The controller verifies it with the pinned device key, every correlation field, its own ephemeral key in `peerEphemeral`, and the pinned agent in `assignedAgent` (another agent closes with 4003 `not_owner`).

Both sides compute `shared = X25519(own secret, peer public)` (an all-zero result closes the connection), `transcript = SHA-256("adp-secure/1" || 0x00 || hello body || accept body)` over the decoded packet bodies, and two keys with HKDF-SHA256 (`ikm = shared`, `salt = transcript`, 32 bytes): info `adp-secure/1 controller-to-device` and `adp-secure/1 device-to-controller`. Each side then deletes its ephemeral secret. The key exchange and the authentication that follows end within five seconds.

From then on every message is one WebSocket binary message: the UTF-8 JSON the plain profile would send, encrypted with ChaCha20-Poly1305 (RFC 8439) under the key for its direction, ciphertext followed by the 16-byte tag, no additional data. The nonce is four zero bytes and a 64-bit big-endian counter that starts at 0 in each direction and grows by one per message. A message that does not decrypt with the next expected counter, a text message, or a decrypted message over 2,200,000 bytes closes the connection; a replayed, dropped, reordered or changed message therefore closes it too. After 2^32 messages in one direction the sender closes, and the device reconnects with a new key exchange. Ping and pong frames carry no data and are not encrypted.

The unchanged profile runs inside, starting with the controller's `hello`: every signature, pin, one-use challenge and limit still applies. A device that uses `/v1/secure` MUST NOT fall back to `/v1/connect` when the encrypted connection fails, so that no one on the network can force a downgrade. The key exchange gives confidentiality, integrity and forward secrecy against the network. It does not hide the device key in the path, the addresses, or the timing and size of messages. Test vectors are in `tests/vectors/secure-v1.json`.

## Authentication and lifecycle

1. The controller looks up the URL key in its operator-configured inventory. Unknown keys are refused before upgrade. The key selects the agent's controller identity; there is no single signing key for all agents on a host.
2. The controller sends `{type:"hello",challenge}` with a fresh 24-byte random hex challenge. The handshake expires after five seconds.
3. The device signs `{type:"connect",id,challenge,to:controllerKey,deviceChallenge,assignedAgent}`. `id` and `deviceChallenge` are fresh 24-byte random hex values. The controller verifies the pinned device key, target, assigned address and connection-scoped challenge.
4. The controller signs `{type:"connected",id,challenge,to:deviceKey,deviceChallenge}`. The device verifies its pinned controller key and every correlation field before serving any command.
5. The newest authenticated connection replaces an older connection for the same device. Unknown or failed handshakes never displace it. A device MUST connect only to its assigned controller. Transfer closes the old connection, cancels requests and stops reconnecting to the old target. An operator configures the new target locally.

Handshake proofs cannot be replayed on another connection. A connection is not continuing authority to invoke: every request still passes the current owner pin, local grant and one-use device challenge checks. Reconnection starts a new handshake and never resubmits an invocation or capture. The device retries transient disconnections with exponential backoff from one to thirty seconds plus up to 25% jitter; a successful session resets the backoff.

Controllers ping every ten seconds and mark a silent connection disconnected within forty seconds: a thirty-second pong threshold checked every ten seconds. Devices terminate after thirty-five seconds without a controller message or ping. A closed connection becomes disconnected immediately. Deployments may choose tighter bounds. At most one authenticated connection is retained per device. The reference listener permits 64 total sockets and eight outstanding calls per device.

## Refusals

A controller says why it refused, so a device never has to guess. Before the upgrade it answers with an HTTP status and an `X-ADP-Refusal` header; after it, it closes with code 4003 and the reason as the close reason.

| Reason | Kind | Meaning |
|---|---|---|
| `unknown_device` | final | The controller has no such device |
| `not_owner` | final | The device names another agent |
| `revoked` | final | The controller removed the device |
| `unsupported_version` | final | The device speaks a version the controller does not |
| `busy` | temporary | Too many connections |

Any other end of a connection, such as a network drop or a controller restart, is temporary, and the device retries with capped backoff. After a final refusal a device tries twice more, because it can connect just before its assignment is complete, then stops and tells its owner why. It stays stopped until a new assignment or a restart by its owner.

## Signed request transport

An outer `{type:"rpc",id,method,body?}` carries a `challenge` or `request` operation. These outer IDs are fresh 24-byte random hex values and correlate transport responses only. A challenge response contains the same one-use device challenge as HTTP. A request body is the unchanged signed v1 packet; its response is the unchanged signed v1 result. The outer reply is `{type:"rpc.result",id,status,body}`. Authority comes from the inner signature and device challenge, not the outer envelope.

A controller must verify the inner result's signature, audience, request ID, challenge and result type exactly as for HTTP. Calls time out after fifteen seconds. `{type:"cancel",id}` aborts the local adapter and discards its result. Disconnect cancels every outstanding call. Late results are discarded, including after a reconnect.

The reference hub provides a signed-packet gateway at `/v1/devices/DEVICE_KEY/challenge` and `/v1/devices/DEVICE_KEY/request`; POST requires a packet signed by that device's assigned controller key. `call({reverse:CONTROLLER_HTTP_ORIGIN}, identity, deviceKey, capability?)` uses this gateway. The gateway is an implementation convenience; a controller may dispatch directly through its connection in the same process.

WebSocket packets and outgoing queues are bounded to 2,200,000 bytes; compression is disabled. Request bodies remain bounded to 800,000 bytes. The first outbound profile carries discovery, invocation, activity and locally approved proposals. Live audio/video and raw PCM speaker streaming remain on the HTTP media profile; the outbound profile does not advertise these streams. Typed text/image/speech output and snapshots work through invocation.

## Device events and input

After authentication the controller issues `{type:"event.challenge",challenge}`. One event consumes it; another fresh challenge is issued only after processing that event. Replayed, forged, wrongly addressed, wrongly assigned or oversized events close the connection. No event may introduce a named human, alternate recipient, privilege, executable or URL.

The device signs one of these exact bodies:

- `{type:"device.used",id,challenge,to:controllerKey,assignedAgent}`
- `{type:"input",id,challenge,to:controllerKey,assignedAgent,text}`, optionally with `via`
- `{type:"audio",id,challenge,to:controllerKey,assignedAgent,data}`

`audio` is what a person said while using a talk control: standard base64 WAV, decoded maximum 640 KiB (20 seconds of 16 kHz mono). It needs the microphone grant, shows the in-use sign while recording, and is sent only because the person chose to. A device never sends it unprompted. The controller acknowledges acceptance at once and turns it into text afterwards; the result is ordinary input, and carries no proof of who spoke. The controller host MAY add `speaker`, `{id,name,confidence}`, from its own voice match against people its operator enrolled: `id` is the host's person id, `name` 1–80 characters, `confidence` from 0 to 1. It is the host's guess, for context only. It is never proof, grants nothing, never comes from the device, and appears only on input turned from `audio`.

`via` names the voice assistant that relayed the person's words to the device, such as `siri`: 1–32 characters, lowercase letters, digits and hyphens, starting with a letter. It tells the agent how its answer reaches the person: the assistant reads the first reply aloud, and there may be no follow-up. Like the text, it is the device's claim, not a proof, and it grants nothing. A device sends it only when an assistant relayed the words.

Text must contain 1–4096 UTF-8 bytes and non-whitespace content. There are at most four accepted events per second per connection; repeated use-only events are coalesced within one second. The controller derives the source device from the verified key and the recipient from verified ownership. It refreshes ownership before activating the device. Input or use from an idle owned device activates it immediately; this does not change any local hardware grant.

After accepting the event the controller signs `{type:"event.ack",id,challenge,to:deviceKey,accepted:true}`. This acknowledges acceptance into controller handling, not a human identity or proof that the agent has replied. Input delivery is attributed as device input and MUST NOT become a system instruction. A disconnected or timed-out input is not automatically replayed; the person may retry after checking the outcome. The reference controller persists accepted text in its local delivery queue and sends it through AMP. AI Maestro supplies its own delivery path through the SDK's `onEvent` callback.


## Approval receipts during transfer

Before closing a former owner's connection after a local decision, a device may use its fresh event challenge to sign `{type:"proposal.result",id,challenge,to:formerControllerKey,assignedAgent:formerAgent,requestId,change,status,revision,owner}`. Status is confirmed or rejected; owner is the resulting full AMP address or null. This is a receipt for a previously requested change, not continuing hardware authority.

The controller MUST match device key, former agent, request ID and change against its pending request before accepting the receipt. It persists the verified outcome and sends the usual signed event.ack. The device allows at most a bounded receipt acknowledgment interval (five seconds, plus up to one second to obtain an available event challenge), during which its bridge already refuses hardware operations using the former owner key. It then closes that connection. The Controller SDK returns the cached verified receipt on a repeat propose call with the same request ID and change. An interrupted receipt delivery leaves the operator outcome unconfirmed; it must not be reported as success merely because the device disconnected. The local receipt also remains available through the HTTP receipt-only path for 24 hours.
