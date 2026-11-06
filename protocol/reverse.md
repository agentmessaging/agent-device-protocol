# Device-initiated connection profile

This extends [v1](v1.md). An owned device opens a WebSocket directly to its controller at `ws://TAILNET_IPV4:PORT/v1/connect/DEVICE_KEY`. Loopback is also allowed for local tests. Public origins, DNS names, redirects and cloud relays are outside this profile. Tailscale supplies encryption; every authority-bearing message still uses the v1 Ed25519 domain and pinned keys.

## Authentication and lifecycle

1. The controller looks up the URL key in its operator-configured inventory. Unknown keys are refused before upgrade. The key selects the agent's controller identity; there is no single signing key for all agents on a host.
2. The controller sends `{type:"hello",challenge}` with a fresh 24-byte random hex challenge. The handshake expires after five seconds.
3. The device signs `{type:"connect",id,challenge,to:controllerKey,deviceChallenge,assignedAgent}`. `id` and `deviceChallenge` are fresh 24-byte random hex values. The controller verifies the pinned device key, target, assigned address and connection-scoped challenge.
4. The controller signs `{type:"connected",id,challenge,to:deviceKey,deviceChallenge}`. The device verifies its pinned controller key and every correlation field before serving any command.
5. The newest authenticated connection replaces an older connection for the same device. Unknown or failed handshakes never displace it. A device MUST connect only to its assigned controller. Transfer closes the old connection, cancels requests and stops reconnecting to the old target. An operator configures the new target locally.

Handshake proofs cannot be replayed on another connection. A connection is not continuing authority to invoke: every request still passes the current owner pin, local grant and one-use device challenge checks. Reconnection starts a new handshake and never resubmits an invocation or capture. The device retries transient disconnections with exponential backoff from one to thirty seconds plus up to 25% jitter; a successful session resets the backoff.

Controllers ping every ten seconds and mark a silent connection disconnected within forty seconds: a thirty-second pong threshold checked every ten seconds. Devices terminate after thirty-five seconds without a controller message or ping. A closed connection becomes disconnected immediately. Deployments may choose tighter bounds. At most one authenticated connection is retained per device. The reference listener permits 64 total sockets and eight outstanding calls per device.

## Signed request transport

An outer `{type:"rpc",id,method,body?}` carries a `challenge` or `request` operation. These outer IDs are fresh 24-byte random hex values and correlate transport responses only. A challenge response contains the same one-use device challenge as HTTP. A request body is the unchanged signed v1 packet; its response is the unchanged signed v1 result. The outer reply is `{type:"rpc.result",id,status,body}`. Authority comes from the inner signature and device challenge, not the outer envelope.

A controller must verify the inner result's signature, audience, request ID, challenge and result type exactly as for HTTP. Calls time out after fifteen seconds. `{type:"cancel",id}` aborts the local adapter and discards its result. Disconnect cancels every outstanding call. Late results are discarded, including after a reconnect.

The reference hub provides a signed-packet gateway at `/v1/devices/DEVICE_KEY/challenge` and `/v1/devices/DEVICE_KEY/request`; POST requires a packet signed by that device's assigned controller key. `call({reverse:CONTROLLER_HTTP_ORIGIN}, identity, deviceKey, capability?)` uses this gateway. The gateway is an implementation convenience; a controller may dispatch directly through its connection in the same process.

WebSocket packets and outgoing queues are bounded to 2,200,000 bytes; compression is disabled. Request bodies remain bounded to 800,000 bytes. The first outbound profile carries discovery, invocation, activity and locally approved proposals. Live audio/video and raw PCM speaker streaming remain on the HTTP media profile; the outbound profile does not advertise these streams. Typed text/image/speech output and snapshots work through invocation.

## Device events and input

After authentication the controller issues `{type:"event.challenge",challenge}`. One event consumes it; another fresh challenge is issued only after processing that event. Replayed, forged, wrongly addressed, wrongly assigned or oversized events close the connection. No event may introduce a named human, alternate recipient, privilege, executable or URL.

The device signs one of these exact bodies:

- `{type:"device.used",id,challenge,to:controllerKey,assignedAgent}`
- `{type:"input",id,challenge,to:controllerKey,assignedAgent,text}`

Text must contain 1–4096 UTF-8 bytes and non-whitespace content. There are at most four accepted events per second per connection; repeated use-only events are coalesced within one second. The controller derives the source device from the verified key and the recipient from verified ownership. It refreshes ownership before activating the device. Input or use from an idle owned device activates it immediately; this does not change any local hardware grant.

After accepting the event the controller signs `{type:"event.ack",id,challenge,to:deviceKey,accepted:true}`. This acknowledges acceptance into controller handling, not a human identity or proof that the agent has replied. Input delivery is attributed as device input and MUST NOT become a system instruction. A disconnected or timed-out input is not automatically replayed; the person may retry after checking the outcome. The reference controller persists accepted text in its local delivery queue and sends it through AMP. AI Maestro supplies its own delivery path through the SDK's `onEvent` callback.


## Approval receipts during transfer

Before closing a former owner's connection after a local decision, a device may use its fresh event challenge to sign `{type:"proposal.result",id,challenge,to:formerControllerKey,assignedAgent:formerAgent,requestId,change,status,revision,owner}`. Status is confirmed or rejected; owner is the resulting full AMP address or null. This is a receipt for a previously requested change, not continuing hardware authority.

The controller MUST match device key, former agent, request ID and change against its pending request before accepting the receipt. It persists the verified outcome and sends the usual signed event.ack. The device allows at most a bounded receipt acknowledgment interval (five seconds, plus up to one second to obtain an available event challenge), during which its bridge already refuses hardware operations using the former owner key. It then closes that connection. The Controller SDK returns the cached verified receipt on a repeat propose call with the same request ID and change. An interrupted receipt delivery leaves the operator outcome unconfirmed; it must not be reported as success merely because the device disconnected. The local receipt also remains available through the HTTP receipt-only path for 24 hours.
