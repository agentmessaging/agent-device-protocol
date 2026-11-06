import {
  Controller,
  type ControllerSnapshot,
} from "@ai-maestro/device-sdk/controller";
import { DeviceConnection } from "@ai-maestro/device-sdk/reverse";
import { identity, call } from "@ai-maestro/device-sdk";
const c = new Controller({
  onEvent: async (event) => {
    const address: string = event.agent;
    void address;
  },
  onStateChange: (state: ControllerSnapshot) => {
    void state;
  },
});
c.addAgent({ address: "plain@host.local" });
c.addAgent({ address: "lola@host.local", identity: identity() });
c.pinDevice("lola@host.local", {
  key: identity().key,
  endpoint: { reverse: "http://127.0.0.1:23112" },
});
const hub = c.createHub();
hub.server.listen(23112, "127.0.0.1");
const snapshot: ControllerSnapshot = c.snapshot();
void snapshot;
void c.invoke("lola@host.local", identity().key, "display.text", {
  text: "hello",
});
void call({ reverse: "http://127.0.0.1:23112" }, identity(), identity().key);
const bridge = new DeviceConnection({
  origin: "http://127.0.0.1:23112",
  identity: identity(),
  getPeer: () => ({ key: identity().key, assignedAgent: "lola@host.local" }),
  adapter: async () => ({ status: 200, body: {} }),
});
void bridge.input("hello");
void bridge.stop();
