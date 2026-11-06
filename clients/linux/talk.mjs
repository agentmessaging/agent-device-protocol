import { wav } from "../../packages/sdk/media.mjs";
import { captureMedia } from "./media.mjs";

const MAX_SECONDS = 20;

/** Hold to talk. The microphone grant and the in-use sign apply as to any recording. */
export class PushToTalk {
  constructor({ getPeer, display, send, capture = captureMedia }) {
    Object.assign(this, { getPeer, display, send, capture });
    this.session = null;
  }
  async start() {
    if (this.session) return;
    if (this.getPeer().media?.microphone !== true)
      throw new Error("Microphone not allowed");
    await this.display.indicate("microphone");
    const chunks = [];
    const session = { chunks };
    this.session = session;
    session.sign = setInterval(
      () => this.display.keepIndicator("microphone"),
      1000,
    );
    session.stop = this.capture(
      "microphone",
      MAX_SECONDS,
      (chunk) => chunks.push(Buffer.from(chunk)),
      () => {
        // Time ran out while still held: send what there is
        if (this.session === session) void this.stop();
      },
    );
  }
  async stop() {
    const session = this.session;
    if (!session) return false;
    this.session = null;
    clearInterval(session.sign);
    session.stop?.();
    const pcm = Buffer.concat(session.chunks);
    // Under half a second is a slip of the finger
    if (pcm.length < 16000) return false;
    await this.send(wav(pcm));
    return true;
  }
  cancel() {
    if (!this.session) return;
    clearInterval(this.session.sign);
    this.session.stop?.();
    this.session = null;
  }
}
