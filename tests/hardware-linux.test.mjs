import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { runCapture } from "../clients/linux/media.mjs";
test(
  "ffmpeg adapter parses real encoded camera frames and PCM with bounded chunks",
  { skip: !existsSync("/usr/bin/ffmpeg") },
  async () => {
    for (const kind of ["video", "microphone"]) {
      const frames = [];
      const input =
        kind === "video"
          ? [
              "-f",
              "lavfi",
              "-i",
              "color=blue:size=160x120:rate=5",
              "-c:v",
              "mjpeg",
              "-f",
              "image2pipe",
            ]
          : [
              "-f",
              "lavfi",
              "-i",
              "sine=frequency=440:sample_rate=16000",
              "-ac",
              "1",
              "-f",
              "s16le",
            ];
      await new Promise((resolve, reject) =>
        runCapture(
          ["-nostdin", "-loglevel", "error", ...input, "-t", "1", "pipe:1"],
          kind,
          (chunk) => frames.push(Buffer.from(chunk)),
          (error) => (error ? reject(new Error(error)) : resolve()),
        ),
      );
      assert.ok(frames.length > 0);
      if (kind === "video") {
        assert.equal(frames[0].readUInt16BE(0), 0xffd8);
        assert.equal(frames[0].readUInt16BE(frames[0].length - 2), 0xffd9);
      } else assert.ok(frames.every((frame) => frame.length === 3200));
    }
  },
);
