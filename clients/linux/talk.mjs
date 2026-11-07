import { wav } from "../../packages/sdk/media.mjs";
import { captureMedia } from "./media.mjs";
import { loudness } from "./output.mjs";

const MAX_SECONDS = 20;

/** Tap to talk, tap to send. The microphone grant and the in-use sign apply as to any recording. */
export class PushToTalk {
  constructor({ getPeer, display, send, capture = captureMedia, voice, used }) {
    Object.assign(this, { getPeer, display, send, capture, voice, used });
    this.session = null;
  }
  async start() {
    if (this.session) return;
    if (this.getPeer().media?.microphone !== true)
      throw new Error("Microphone not allowed");
    // First, before anything can be recorded: her voice must not reach the microphone
    this.voice?.hush();
    try {
      await this.display.indicate("microphone");
      // The sign can take a second, and a local stop may have come in that time
      if (this.getPeer().media?.microphone !== true)
        throw new Error("Microphone not allowed");
    } catch (error) {
      this.voice?.release();
      throw error;
    }
    const chunks = [];
    const session = { chunks };
    this.session = session;
    this.display.talking = true;
    // Tells the controller someone is talking now, before the words: it can get ready while they speak
    Promise.resolve().then(() => this.used?.()).catch(() => {});
    session.sign = setInterval(
      () => this.display.keepIndicator("microphone"),
      1000,
    );
    session.stop = this.capture(
      "microphone",
      MAX_SECONDS,
      (chunk) => {
        chunks.push(Buffer.from(chunk));
        this.display.you = loudness(chunk);
      },
      () => {
        // Time ran out while still held: send what there is
        if (this.session === session) this.stop().catch(() => {});
      },
    );
  }
  async stop() {
    const session = this.session;
    if (!session) return false;
    this.end(session);
    const pcm = Buffer.concat(session.chunks);
    // Under half a second is a slip of the finger
    if (pcm.length < 16000) return false;
    await this.send(wav(pcm));
    return true;
  }
  cancel() {
    if (this.session) this.end(this.session);
  }
  end(session) {
    this.session = null;
    clearInterval(session.sign);
    session.stop?.();
    this.display.talking = false;
    this.voice?.release();
  }
}
