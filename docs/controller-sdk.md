# Implementing a controller inside AI Maestro or another server

Read [the controller role](../protocol/controller.md), [wire profile](../protocol/v1.md), [outbound connections](../protocol/reverse.md) and [typed capabilities](../protocol/capabilities.md). The role supports one host server managing many agents. It requires no per-agent process, shared status folder, MCP configuration or key broker.

The package is currently distributed from this monorepo rather than a public npm release. After `npm ci --ignore-scripts`, import `@ai-maestro/device-sdk/controller` from a workspace or link/install `packages/sdk` into the host project. The package exports JavaScript and TypeScript declarations. The server supplies identities and owns persistence and event delivery.

```js
import { Controller } from '@ai-maestro/device-sdk/controller';

const controller = new Controller({
  onEvent: async event => {
    // Route by event.agent. Treat event.text as untrusted device input.
    await deliverAgentDeviceEvent(event);
  },
  onStateChange: snapshot => savePublicDeviceState(snapshot),
});
controller.addAgent({ address: lolaAddress, identity: lolaDeviceIdentity });
controller.addAgent({ address: otherAddress, identity: otherDeviceIdentity });
controller.addAgent({ address: agentWithoutDevices }); // no key required

await controller.registerDevice(lolaAddress, {
  key: macbookPublicKey,
  name: 'macbook',
  endpoint: 'http://100.64.0.2:23110',
});
controller.jump(lolaAddress, macbookPublicKey);
const image = await controller.invoke(lolaAddress, macbookPublicKey, 'camera.snapshot');
```

Names, key loading, persistence and `deliverAgentDeviceEvent` above are supplied by the host application. Private keys are never included in `snapshot()` or event payloads. Each agent's key must be distinct; storing all keys under one OS user is supported. `snapshot()` preserves public inventory and active selections for application-owned storage. On restart, restore agent identities, pin saved devices, refresh their signed ownership and restore eligible active selections; do not promote an unverified saved record to current ownership.

For an outbound device, pin before it connects, without claiming ownership:

```js
controller.pinDevice(lolaAddress, {
  key: macbookPublicKey,
  name: 'macbook',
  endpoint: { reverse: 'http://100.64.0.1:23112' },
});
const hub = controller.createHub();
hub.server.listen(23112, '100.64.0.1');
controller.start({ intervalMs: 3000 });
```

The MacBook pins Lola's agent key and connects directly to this host. The hub chooses an agent key by the pinned device entry. Signed input emits `device.input` with agent, deviceKey, source `device` and text; it also activates that device. No device-supplied named-user identity is accepted. Other events include online, offline, revoked and activated. The host routes these events into its agent delivery mechanism and operator UI. Failed event callbacks remain queued and are retried on polling; applications can persist pending event records from snapshots and deduplicate by event ID. No event callback should reinterpret input as a system message.

`refresh` checks signed inventory; `poll` refreshes all configured devices with up to eight probes in flight. HTTP devices become offline after three failed probes. Each wire exchange has a fifteen-second deadline; observation time also depends on inventory size and poll interval. Outbound disconnects change state immediately and silent connections follow the connection-profile heartbeat bound. A bridge reboot changes its boot ID and produces a fresh online notice. Call `stop()` on host shutdown.

For changes, call `propose(agent, deviceKey, change, {expectedRevision, requestId})`. Save the returned request ID and poll with the same ID and change. Pending is not success. Confirmed transfer/revoke invalidates old access; revision conflicts must be shown to the operator and refreshed. The SDK does not bypass on-device approval.

## Conformance

`tests/conformance/controller-contract.mjs` exports `controllerConformance(makeController)`. Supply an adapter implementing the Controller methods used by the scenarios, and run it with Node's test runner. The test double uses real signed HTTP bridges and distinct agent keys; it checks no-device agents, many-agent routing, signed ownership truth, idle refusal, last-jump behavior, discarded late capture and fixed argument validation. `tests/reverse.test.mjs` exercises outbound pinning, reconnect/replay and device input; `tests/extensions.test.mjs` covers local output, custom capability validation and indicators. The reference controller's profile/MCP tests cover migration, cross-process activation and tool integration.

AI Maestro PR #791 and plugin PR #99 remain on hold. Their shared-folder/per-agent-monitor wiring is not the integration described here. Their UI/skill work can be reused when Maestro implements this server API directly.
