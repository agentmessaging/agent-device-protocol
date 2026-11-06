import { call, exchange } from "@ai-maestro/device-sdk";
import { streamMedia, wav } from "../../packages/sdk/media.mjs";
import { config } from "./registry.mjs";
import { self } from "../../packages/sdk/state.mjs";

const device = { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" };
const schema = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties).filter((k) => k !== "seconds"),
  additionalProperties: false,
});
export const toolDefinitions = [
  {
    name: "device_list",
    description:
      "List devices assigned to this agent, with verified capabilities and availability.",
    inputSchema: schema({}),
  },
  {
    name: "device_health",
    description: "Check an assigned device's signed health report.",
    inputSchema: schema({ device }),
  },
  {
    name: "device_snapshot",
    description:
      "Take one photo on an assigned device with local camera permission. Returns the image.",
    inputSchema: schema({ device }),
  },
  {
    name: "device_camera_live",
    description:
      "Open a live camera session, visible in the device's PiP, for up to 30 seconds. Requires local live-camera consent. Returns the latest image.",
    inputSchema: schema({
      device,
      seconds: { type: "integer", minimum: 1, maximum: 30, default: 5 },
    }),
  },
  {
    name: "device_microphone",
    description:
      "Record up to 10 seconds from the assigned device microphone with local consent. Returns WAV audio.",
    inputSchema: schema({
      device,
      seconds: { type: "integer", minimum: 1, maximum: 10, default: 5 },
    }),
  },
  {
    name: "device_speaker",
    description:
      "Play up to 10 seconds of raw signed 16-bit little-endian mono 16 kHz PCM, supplied as base64, on the assigned device. Requires local speaker consent.",
    inputSchema: schema({ device, pcm: { type: "string", maxLength: 426668 } }),
  },
];
const text = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});
export async function executeTool(
  name,
  args = {},
  signal,
  dependencies = { config, self, call, exchange, streamMedia },
) {
  const definition = toolDefinitions.find((t) => t.name === name);
  if (
    !definition ||
    !args ||
    Array.isArray(args) ||
    typeof args !== "object" ||
    Object.keys(args).some(
      (k) => !Object.hasOwn(definition.inputSchema.properties, k),
    )
  )
    throw new Error("Unknown tool or arguments");
  const registry = dependencies.config(),
    identity = dependencies.self();
  const requestFetch = (url, options) =>
    fetch(url, {
      ...options,
      signal: signal
        ? AbortSignal.any([signal, options.signal])
        : options.signal,
    });
  const discover = async (device) => {
    const result = await dependencies.call(
      device.origin,
      identity,
      device.key,
      undefined,
      requestFetch,
    );
    if (result.assignedAgent !== registry.agent)
      throw new Error("Device is assigned to another agent");
    return result;
  };
  if (name === "device_list") {
    const records = await Promise.all(
      Object.entries(registry.devices).map(async ([name, device]) => {
        try {
          const r = await discover(device);
          return {
            name,
            agent: r.assignedAgent,
            online: true,
            capabilities: r.capabilities,
            streams: r.streams,
          };
        } catch {
          return { name, online: false };
        }
      }),
    );
    return text(records);
  }
  if (
    typeof args.device !== "string" ||
    !Object.hasOwn(registry.devices, args.device)
  )
    throw new Error("Unknown device");
  const device = registry.devices[args.device];
  await discover(device);
  if (name === "device_health" || name === "device_snapshot") {
    const result = await dependencies.call(
      device.origin,
      identity,
      device.key,
      name === "device_health" ? "device.health" : "camera.snapshot",
      requestFetch,
    );
    if (!result.ok) throw new Error(result.error);
    if (name === "device_snapshot")
      return {
        content: [
          { type: "image", mimeType: "image/jpeg", data: result.value.data },
        ],
      };
    return text(result.value);
  }
  if (name === "device_speaker") {
    if (typeof args.pcm !== "string" || args.pcm.length > 426668)
      throw new Error("Invalid PCM");
    const data = Buffer.from(args.pcm, "base64");
    if (
      !data.length ||
      data.length % 2 ||
      data.length > 320000 ||
      data.toString("base64") !== args.pcm
    )
      throw new Error("Invalid PCM");
    const result = await dependencies.exchange(
      device.origin,
      identity,
      device.key,
      { type: "speaker", data: args.pcm },
      "result",
      requestFetch,
    );
    if (!result.ok) throw new Error(result.error);
    return text(result.value);
  }
  const seconds = args.seconds ?? 5;
  const video = name === "device_camera_live";
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > (video ? 30 : 10))
    throw new Error("Invalid duration");
  const audio = [];
  let latest,
    total = 0;
  for await (const frame of dependencies.streamMedia(
    device.origin,
    identity,
    device.key,
    video ? "video" : "microphone",
    seconds,
    signal,
  )) {
    if (video) latest = frame.bytes;
    else {
      total += frame.bytes.length;
      if (total > 320000) throw new Error("Audio limit exceeded");
      audio.push(frame.bytes);
    }
  }
  if (video) {
    if (!latest) throw new Error("Camera produced no frames");
    return {
      content: [
        {
          type: "image",
          mimeType: "image/jpeg",
          data: latest.toString("base64"),
        },
      ],
    };
  }
  if (!total) throw new Error("Microphone produced no audio");
  return {
    content: [
      {
        type: "audio",
        mimeType: "audio/wav",
        data: wav(Buffer.concat(audio)).toString("base64"),
      },
    ],
  };
}
