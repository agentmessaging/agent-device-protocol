// Reserved adapter contract. A future implementation must negotiate a format,
// enforce local consent, stop on disconnect and bound frame buffers.
export const audioProfiles = Object.freeze({
  "microphone.stream": { direction: "device-to-agent", enabled: false },
  "speaker.play": { direction: "agent-to-device", enabled: false },
});
