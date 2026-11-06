import {
  builtinCapabilities,
  validateArguments,
  validateSchema,
  imageBytes,
} from "../../packages/sdk/capabilities.mjs";
import { call, exchange } from "@ai-maestro/device-sdk";
import { streamMedia, wav } from "../../packages/sdk/media.mjs";
import { config, state } from "./registry.mjs";
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
    name: "device_show_text",
    description:
      "Show plain text on the active device with local display permission.",
    inputSchema: schema({ device, text: { type: "string", maxLength: 4096 } }),
  },
  {
    name: "device_show_image",
    description:
      "Show a bounded JPEG or PNG on the active device with local display permission.",
    inputSchema: schema({
      device,
      mime: { type: "string", enum: ["image/jpeg", "image/png"] },
      data: { type: "string", maxLength: 349528 },
    }),
  },
  {
    name: "device_say",
    description:
      "Speak a short plain-text reply on the active device, using its locally granted speech adapter.",
    inputSchema: schema({ device, text: { type: "string", maxLength: 500 } }),
  },
  {
    name: "device_custom",
    description:
      "Invoke an owner-installed custom capability from the verified device manifest. Only its declared typed arguments are accepted.",
    inputSchema: schema({
      device,
      capability: {
        type: "string",
        pattern: "^custom\\.[a-z][a-z0-9_-]*\\.[a-z][a-z0-9_-]*$",
      },
      args: { type: "object" },
    }),
  },
  {
    name: "device_jump",
    description:
      "Activate one owned device, or use none to leave all devices idle. The previous device becomes idle immediately.",
    inputSchema: schema({ device }),
  },
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
  dependencies = { config, self, call, exchange, streamMedia, state },
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
  const registry = dependencies.config();
  const controllerState = dependencies.state ?? state;
  if (name === "device_list" && !Object.keys(registry.devices).length)
    return text([]);
  if (name === "device_jump") {
    const target =
      args.device === "none" ? null : registry.devices[args.device];
    if (args.device !== "none" && !target) throw new Error("Unknown device");
    controllerState.jump(target?.key ?? null);
    return text({ active: target?.name ?? args.device });
  }
  const identity = dependencies.self();
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
    if (result.assignedAgent !== registry.agent) {
      controllerState.clearIfActive(device.key);
      throw new Error("Device is assigned to another agent");
    }
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
            active: controllerState.active().key === device.key,
            capabilities: r.capabilities,
            streams: r.streams,
            capabilityDefinitions: r.capabilityDefinitions,
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
  let guard = ["device_health", "device_custom"].includes(name)
    ? null
    : controllerState.guard(device.key, signal);
  if (guard) signal = guard.signal;
  const execute = async () => {
    let registration;
    try {
      registration = await discover(device);
    } catch (error) {
      if (/403|another agent/.test(error.message))
        controllerState.clearIfActive(device.key);
      throw error;
    }
    guard?.check();
    const outputCapabilities = {
      device_show_text: "display.text",
      device_show_image: "display.image",
      device_say: "speaker.say",
    };
    if (outputCapabilities[name] || name === "device_custom") {
      const capability = outputCapabilities[name] ?? args.capability;
      if (
        typeof capability !== "string" ||
        (name === "device_custom" &&
          !/^custom\.[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$/.test(capability)) ||
        !registration.capabilities.includes(capability)
      )
        throw new Error("Capability is not granted or available");
      const definition =
        builtinCapabilities[capability] ??
        registration.capabilityDefinitions?.[capability];
      if (!definition) throw new Error("Missing capability definition");
      const payload =
        name === "device_custom"
          ? args.args
          : name === "device_show_image"
            ? { mime: args.mime, data: args.data }
            : { text: args.text };
      if (name === "device_custom") {
        validateSchema(definition.args);
        if (definition.activation !== "any") {
          guard = controllerState.guard(device.key, signal);
          signal = guard.signal;
        }
      }
      validateArguments(definition.args, payload);
      if (capability === "display.image") imageBytes(payload);
      const result = await dependencies.exchange(
        device.origin,
        identity,
        device.key,
        { type: "invoke", capability, args: payload },
        "result",
        requestFetch,
      );
      if (!result.ok) throw new Error(result.error);
      return text(result.value);
    }
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
    if (
      !Number.isInteger(seconds) ||
      seconds < 1 ||
      seconds > (video ? 30 : 10)
    )
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
      guard?.check();
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
  };
  try {
    const result = await execute();
    guard?.check();
    return result;
  } finally {
    guard?.close();
  }
}
