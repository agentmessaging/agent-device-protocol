import { validateChange, sameChange } from "../../packages/sdk/changes.mjs";
export { validateChange };
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
  request(id, change, expectedRevision) {
    validateChange(change);
    const receipt = this.receipt();
    if (receipt?.id === id) {
      if (!sameChange(receipt.change, change))
        throw new Error("Request ID reused");
      return receipt;
    }
    const current = this.getPeer();
    if (expectedRevision !== undefined && expectedRevision !== current.revision)
      return { id, status: "revision_mismatch", revision: current.revision };
    const pending = this.pending();
    if (pending && pending.id !== id)
      throw new Error("A change already awaits local approval");
    if (pending) {
      if (!sameChange(pending.change, change))
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
    let current;
    try {
      current = this.getPeer();
    } catch {
      current = null;
    }
    this.save({
      pending: null,
      receipt: {
        ...request,
        status: approve ? "confirmed" : "rejected",
        revision: current?.revision ?? null,
        assignedAgent: current?.assignedAgent ?? null,
        expiresAt: Date.now() + 86400000,
      },
    });
  }
}
