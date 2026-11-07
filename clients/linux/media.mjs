import { spawn } from "node:child_process";
import {
  cameraInput,
  cameraPresent,
  ffmpegPath,
  ffmpegReady,
  microphoneInput,
  speakerOutput,
} from "./platform.mjs";

import { mediaFormats as formats } from "../../packages/sdk/media.mjs";
export { formats };
export function mediaAvailable(kind) {
  return ffmpegReady() && (kind !== "video" || cameraPresent());
}
export function captureMedia(kind, seconds, onData, onEnd) {
  const input =
    kind === "video"
      ? [
          ...cameraInput("10"),
          "-vf",
          "fps=5,scale=640:-2",
          "-c:v",
          "mjpeg",
          "-q:v",
          "5",
          "-f",
          "image2pipe",
        ]
      : [
          ...microphoneInput,
          "-ac",
          "1",
          "-ar",
          "16000",
          "-f",
          "s16le",
        ];
  return runCapture(
    [
      "-nostdin",
      "-loglevel",
      "error",
      ...input,
      "-t",
      String(seconds),
      "pipe:1",
    ],
    kind,
    onData,
    onEnd,
  );
}
/** The local preview: same device and format as a video session, at a lower rate, with no end time. */
export function previewCamera(onData, onEnd) {
  return runCapture(
    [
      "-nostdin",
      "-loglevel",
      "error",
      ...cameraInput("10"),
      "-vf",
      "fps=4,scale=640:-2",
      "-c:v",
      "mjpeg",
      "-q:v",
      "7",
      "-f",
      "image2pipe",
      "pipe:1",
    ],
    "video",
    onData,
    onEnd,
  );
}
export function runCapture(
  args,
  kind,
  onData,
  onEnd,
  executable = ffmpegPath,
) {
  const child = spawn(executable, args, {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const limit = formats[kind].maxBytes;
  let buffer = Buffer.alloc(0),
    ended = false;
  const stop = () => {
    if (!ended) child.kill("SIGKILL");
  };
  const finish = (error) => {
    if (ended) return;
    ended = true;
    onEnd(error);
  };
  child.on("error", () => finish("hardware_unavailable"));
  child.on("close", (code) =>
    finish(code === 0 ? undefined : "hardware_unavailable"),
  );
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (kind === "microphone") {
      while (buffer.length >= 3200) {
        onData(buffer.subarray(0, 3200));
        buffer = buffer.subarray(3200);
      }
    } else {
      let end;
      while ((end = buffer.indexOf(Buffer.from([255, 217]))) >= 0) {
        const frame = buffer.subarray(0, end + 2);
        buffer = buffer.subarray(end + 2);
        if (frame.length > limit || frame[0] !== 255 || frame[1] !== 216) {
          stop();
          return;
        }
        onData(frame);
      }
    }
    if (buffer.length > limit) stop();
  });
  return stop;
}
export function playPCM(data, onEnd) {
  const child = spawn(
    ffmpegPath,
    [
      "-loglevel",
      "error",
      "-f",
      "s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-i",
      "pipe:0",
      ...speakerOutput,
    ],
    { stdio: ["pipe", "ignore", "ignore"] },
  );
  let ended = false;
  const finish = (error) => {
    if (ended) return;
    ended = true;
    onEnd(error);
  };
  child.on("error", () => finish("hardware_unavailable"));
  child.on("close", (code) =>
    finish(code === 0 ? undefined : "hardware_unavailable"),
  );
  child.stdin.on("error", () => {});
  child.stdin.end(data);
  return () => {
    if (!ended) child.kill("SIGKILL");
  };
}

// Owns capture/playback processes and makes local revoke/stop apply to every session.
export class MediaManager {
  constructor(
    getPeer,
    display,
    hardware = { captureMedia, playPCM, mediaAvailable },
  ) {
    this.getPeer = getPeer;
    this.display = display;
    this.hardware = hardware;
    this.sessions = new Map();
  }
  allowed(kind, peer) {
    return (
      peer?.media?.[kind] === true &&
      this.hardware.mediaAvailable(kind) &&
      (kind === "speaker" ||
        (this.hardware.indicatorReady?.() ??
          this.display?.indicatorReady() ??
          false))
    );
  }
  advertised(peer) {
    return Object.keys(formats).filter((k) => this.allowed(k, peer));
  }
  sameGrant(peer, kind) {
    try {
      const current = this.getPeer();
      return (
        current.key === peer.key &&
        current.assignedAgent === peer.assignedAgent &&
        current.revision === peer.revision &&
        this.allowed(kind, current)
      );
    } catch {
      return false;
    }
  }
  run(kind, peer, seconds, onData, onEnd, data) {
    if (!this.allowed(kind, peer)) throw new Error("permission_denied");
    if (this.sessions.has(kind)) throw new Error("media_busy");
    let stop = () => {},
      done = false,
      timer,
      deadline;
    // /dev/video0 is exclusive: the local preview lets go before a session opens it
    const video = kind === "video";
    const released = video ? this.hardware.pauseCamera?.() : undefined;
    const finish = (reason) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      clearTimeout(deadline);
      this.sessions.delete(kind);
      stop();
      if (video) this.hardware.resumeCamera?.();
      this.display?.mediaStopped(kind);
      onEnd(reason);
    };
    this.sessions.set(kind, finish);
    this.display?.mediaStarted(peer, kind);
    const deliver = (chunk) => {
      if (done) return;
      if (!this.sameGrant(peer, kind)) return finish("revoked");
      if (kind === "video")
        this.display?.capture(peer, { data: chunk.toString("base64") });
      onData(chunk);
    };
    timer = setInterval(() => {
      if (!this.sameGrant(peer, kind)) finish("revoked");
    }, 100);
    deadline = setTimeout(() => finish("completed"), seconds * 1000 + 1000);
    const start = async () => {
      try {
        if (kind !== "speaker") {
          if (this.hardware.indicate) await this.hardware.indicate(kind);
          else await this.display.indicate(kind);
        }
        await released;
        if (done) return;
        stop =
          kind === "speaker"
            ? this.hardware.playPCM(data, (error) =>
                finish(error || "completed"),
              )
            : this.hardware.captureMedia(kind, seconds, deliver, (error) =>
                finish(error || "completed"),
              );
        if (done) stop();
      } catch {
        finish("hardware_unavailable");
      }
    };
    void start();
    return () => finish("stopped");
  }
  stopAll() {
    for (const finish of [...this.sessions.values()]) finish("stopped");
  }
  active() {
    return [...this.sessions.keys()];
  }
}
