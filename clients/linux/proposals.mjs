import { agentAddress, publicKey } from "@ai-maestro/device-sdk";

export function validateChange(change) {
  if (!change || typeof change !== "object" || Array.isArray(change))
    throw new Error("Invalid change");
  if (
    change.action === "transfer" &&
    Object.keys(change).every((k) => ["action", "agent", "key"].includes(k))
  ) {
    agentAddress(change.agent);
    publicKey(change.key);
    return;
  }
  if (
    change.action === "camera" &&
    typeof change.enabled === "boolean" &&
    Object.keys(change).every((k) => ["action", "enabled"].includes(k))
  )
    return;
  if (change.action === "revoke" && Object.keys(change).length === 1) return;
  throw new Error("Unsupported device change");
}
export class Proposals {
  constructor(getPeer, load, save, apply) {
    Object.assign(this, { getPeer, load, save, apply });
  }
  receipt() {
    const receipt = this.load()?.receipt;
    return receipt?.expiresAt > Date.now() ? receipt : null;
  }
  pending() {
    const request = this.load()?.pending;
    if (!request) return null;
    let peer;
    try {
      peer = this.getPeer();
    } catch {
      return null;
    }
    if (
      request.expiresAt < Date.now() ||
      peer.key !== request.ownerKey ||
      peer.revision !== request.revision
    )
      return null;
    return request;
  }
  request(id, change) {
    validateChange(change);
    const receipt = this.receipt();
    if (receipt?.id === id) {
      if (JSON.stringify(receipt.change) !== JSON.stringify(change))
        throw new Error("Request ID reused");
      return receipt;
    }
    const pending = this.pending();
    if (pending && pending.id !== id)
      throw new Error("A change already awaits local approval");
    if (pending) {
      if (JSON.stringify(pending.change) !== JSON.stringify(change))
        throw new Error("Request ID reused");
      return pending;
    }
    const peer = this.getPeer();
    if (
      change.action === "transfer" &&
      change.agent !== peer.assignedAgent &&
      change.key === peer.key
    )
      throw new Error("Transfer requires a new agent key");
    const request = {
      id,
      change,
      ownerKey: peer.key,
      revision: peer.revision,
      expiresAt: Date.now() + 300000,
      status: "awaiting_local_approval",
    };
    this.save({ pending: request, receipt });
    return request;
  }
  decide(id, approve) {
    const request = this.pending();
    if (!request || request.id !== id)
      throw new Error("Change expired or was superseded");
    if (approve) this.apply(request.change);
    this.save({
      pending: null,
      receipt: {
        ...request,
        status: approve ? "confirmed" : "rejected",
        expiresAt: Date.now() + 86400000,
      },
    });
  }
}
