# Controller role — v1

Status: first specification version for issue #15. This document is normative for controllers implementing `ai-maestro-device/1`; the reference CLI is an implementation, not the definition. AI Maestro may implement this role directly in one server for every agent on a host. The keywords MUST, MUST NOT, SHOULD and MAY describe requirements, recommendations and choices respectively.

## Responsibility and authority

A controller acts for zero or more agents. An agent without a device is complete: listing its devices MUST return an empty list, and MUST NOT require generating a device key. For each agent with devices, the controller MUST use that agent's own Ed25519 controller key and full AMP address. It MUST NOT sign one agent's operation with another agent's key. A device has zero or one owner; an agent may own zero or more devices.

Possession or use of a controller key is authority to act as that agent. The protocol does not establish isolation between programs sharing a host, account or key. A controller deployment MAY isolate agents or keys, and MAY instead accept a shared operating-system user. AI Maestro's shared-user model is a supported deployment choice. A key broker and separate accounts are optional hardening in the reference implementation. They are not protocol requirements.

The controller MUST distinguish a configured/pinned device from verified ownership. The device's correlated, signed `register` response is authoritative for its owner, revision, local grants and capabilities. An inventory entry or operator request MUST NOT establish or change ownership. On an ownership mismatch or rejection of previously valid authority, the controller MUST invalidate that authority, cancel access and clear that device's active selection. It MAY retain a history entry explicitly marked unverified, revoked or offline; it MUST NOT describe that entry as verified current ownership.

## Inventory and active device

Inventory is keyed by the device public key, not a URL or user-editable name. The controller MUST pin keys using an out-of-band or locally approved enrollment process. It MUST refresh signed discovery before exposing changed capabilities. Endpoint addresses are routing hints, not identities.

For each agent the controller MUST hold one active device key, or no active device. `discover` and `device.health` MAY operate on idle devices. Sensors, live media and output MUST be refused on idle devices before any request is sent. Custom capabilities declare their activation requirements; unknown or undeclared operations MUST be refused.

A jump MUST atomically replace the active choice and invalidate the previous activation generation. It MUST NOT wait for the previous device, require a lease, or involve agreement between devices. The last accepted jump wins. In-flight old operations MUST be cancelled; their results and subsequent frames MUST NOT be delivered after the jump, including when an old device reconnects. A new connection MUST NOT replay an invocation. A device may briefly finish cancelling hardware locally; that does not authorize releasing its data.

Signed `device.used` and signed user `input` from an owned device count as a jump to that device. The controller MUST verify device identity, freshness and ownership before changing the active selection. Neither event authenticates a named human. Activity updates SHOULD include an `active` boolean for display; this is informational and MUST NOT be treated as a device-enforced security boundary.

## Operations and local authority

The controller MUST expose a fixed operation interface to an agent. It MUST validate capability names, typed arguments, advertised availability, local grants and activation requirements. It MUST NOT provide arbitrary remote shell, executable, file-path, network-URL or markup execution through this interface. A locally installed custom handler is a fixed owner-defined operation, not permission for remote code installation.

Changes to ownership or permission MUST use the locally approved proposal exchange. Queueing a request is not success. A controller MUST present the device's signed pending, confirmed, rejected, expired or revision-conflict outcome accurately. A confirmed transfer clears the old owner's active choice and cached authority, and resets the device's local grants. An operator API or user interface MAY initiate these requests; it does not bypass local approval. Initial enrollment and recovery remain local operations.

Only local device authority may grant access, stop capture or approve ownership changes. A controller MUST NOT suppress an in-use indicator, turn a local denial into success, or infer permission from active selection. A controller MUST handle local revocation during an operation.

## Transport, liveness and delivery

A controller MUST implement signed HTTP discovery/invocation and MUST support accepting device-initiated connections through the outbound connection profile. Both transports use the same signature domain, pinned keys and one-use challenges. A connection is not proof of identity. The outbound profile permits one authenticated connection to the owning agent's controller; reauthentication is required after reconnect. No relay or third-party service is required.

For HTTP devices the controller MUST use bounded health probes and a documented failure threshold. For outbound devices it MUST mark a closed connection disconnected immediately and detect silent connections within the profile timeout. It MUST notify the assigned agent of online/offline transitions and loss of authority through an implementation-provided delivery mechanism. It SHOULD suppress duplicate notices and retry failed deliveries. AMP is AI Maestro's delivery mechanism, not a prerequisite of the device transport.

User input MUST be delivered only to the verified assigned agent, attributed to the device key. The controller MUST NOT promote text or device-supplied fields to a system instruction or named-human identity. Output MUST go only to that agent's active device and use a locally granted, bounded capability.

## Controller-facing SDK contract

`@ai-maestro/device-sdk/controller` exposes a host-process API, independent of environment variables, folders, MCP or background CLI processes. A server creates one `Controller` instance. Agent identity, storage and event delivery are supplied by the caller.

The API surface is:

- `new Controller({ onEvent?, onStateChange?, transport? })`
- `addAgent({ address, identity? })`: register an agent; no identity is needed until it has a device.
- `pinDevice(address, { key, endpoint, name? })`: configure trust/routing; does not claim verified ownership.
- `registerDevice(address, device)`: pin and perform signed discovery.
- `inventory(address)`: return that agent's device records, including verification and active state.
- `refresh(address, deviceKey)`: refresh signed ownership, grants, revision and capabilities.
- `jump(address, deviceKey | null)`: replace the active selection, invalidate old operations and emit the change.
- `invoke(address, deviceKey, capability, args?, { signal? })`: enforce active/idle and typed capability rules, then dispatch the signed operation.
- `media(address, deviceKey, kind, seconds, { signal? })`: enforce activation while consuming each signed frame.
- `propose(address, deviceKey, change, { expectedRevision? })`: submit or check a locally approved change, preserving its request identifier.
- `createHub(options?)`: construct the outbound transport listener; each connection selects the pinned agent identity, not a global host signing key.
- `poll()` / `start(options?)` / `stop()`: integrated host-wide liveness, with no per-agent monitor required.
- `snapshot()`: export public controller state for implementation-owned persistence. Private keys are supplied separately and MUST NOT appear in status events.

The implementation is being completed against this contract in PR #9. The conformance adapter and executable scenarios live in `tests/conformance/`; third-party controllers use the same scenario assertions through an adapter, rather than importing the reference CLI's state or UI.

## Reference implementation choices

`apps/controller` remains a small reference controller and migration tool. Its profile directory, CLI commands, MCP stdio transport, `.mcp.json` installer, monitor process, optional `ADP_DASHBOARD_DIR` adapter and Linux UID broker are choices of that application. None is a requirement for another controller. AI Maestro MUST NOT need the shared-folder adapter or a controller/monitor per agent to implement this role.

Protocol conformance is judged by signed wire behavior, local approval, inventory truth, active-device enforcement, fixed operations and liveness behavior. It is not judged by matching the reference process layout, identity storage, interface or isolation policy.
