# Changelog

## Unreleased

- SDK: `ReverseHub({ relay: true })` is the listener for a public relay such as a Cloudflare tunnel (S006): it accepts only `/v1/secure` (`/v1/connect` is refused with `secure_only`) and never treats the relay's loopback address as local. `DeviceConnection({ secure: true })` accepts an `https://NAME` origin and connects with `wss://`; S003 still runs inside. Definitions and argument checks for `network.add`, `network.remove` and `network.list` (S005). Proposed: these move into the protocol documents when a board passes.
- ESP32 client: listening for a wake phrase (S004) on the XIAO ESP32-S3 Sense, with no button. A microWakeWord model that the owner trains runs on the microphone under a dim LED; the phrase starts the same recording as the talk button (bright LED), with the 480 ms before the detection so no words are lost. After the agent speaks, the board waits 8 seconds for an answer. Register: `permissions.listen` and `wakePhrase`. New 4 MB app partition for the XIAO (the device key survives). Debug console: `vol N` for the speaker volume. Tested on the board with speech-to-text of the clips.
- ESP32 client: talk button and speaker on the XIAO ESP32-S3 Sense. BOOT starts a recording under the LED sign that ends one second after the person stops, and the clip goes to the controller as a signed `audio` event; `speaker.play` plays 16-bit PCM WAV on a MAX98357A (menuconfig: microphone, speaker, pins, volume). Encrypted connection only. The camera, microphone and doctor share one LED sign. The debug build sends logs over Wi-Fi and takes `talk` and `hear` from the USB console. Tested on the board: speech-to-text of a clip matched the sentence, and a person understood the speaker.
- ESP32 client: a hardware doctor for the XIAO ESP32-S3 Sense (`ADP_DOCTOR`). At boot it prints one line per part to the USB console: chip, PSRAM, LED, Wi-Fi, controller address, microphone level, speaker (a 1 kHz tone the microphone must hear) and camera. The speaker amplifier pins are new menuconfig options (D1, D4, D5 by default).
- Proposed S004, listening for a wake phrase: a local `listen` grant (off by default, the controller cannot turn it on), audio kept only in RAM and never sent while listening, a listening sign different from the recording sign, and a detection that becomes the existing `audio` event. Design only; no wire change.
- ESP32 client: `camera.snapshot` on a Seeed XIAO ESP32-S3 Sense, through the encrypted connection only. Turning on the camera option is the owner's grant; the user LED is the capture sign, the camera runs only for the picture, and the answer is a 1024×768 JPEG of at most 1 MiB. Build with the new `sdkconfig.defaults.xiao-s3-sense` (octal PSRAM, 8 MB flash). Tested on the board against the SDK hub.
- ESP32 client: the firmware connects through the encrypted `/v1/secure` (S003) by default, with a new menuconfig option to turn it off for a controller that does not implement S003. It never falls back to a plain connection. Built with ESP-IDF 5.5 for esp32s3 and run on a XIAO ESP32-S3 Sense (Wi-Fi, encrypted NVS, device key); the XIAO needs its external antenna.
- ESP32 client: the C core has the encrypted home network connection (S003). With `secure` set it does the signed X25519 key exchange and then reads and sends only encrypted binary messages, through the new `adp_receive()`; it never falls back to a plain connection. It passes the S003 test vectors and connects to the SDK hub through `/v1/secure` in the host test. The firmware does not use it yet.
- Encrypted home network connection (S003): a device that cannot run Tailscale connects to `/v1/secure/DEVICE_KEY` and the two sides exchange X25519 keys signed with their pinned Ed25519 keys; every message after that is ChaCha20-Poly1305 with implicit counters. From a private address the encrypted connection carries the whole profile, so a board can use its camera, microphone and speaker; a plain one keeps the home network limits. SDK: `ReverseHub` accepts both paths and enforces the limits on plain home network connections (it did not before), and `DeviceConnection({ secure: true })` connects encrypted and never falls back. Test vectors in `tests/vectors/secure-v1.json`.

- `transcribe` may return `{ text, speaker }`. The controller adds a valid `speaker` (`{id, name, confidence}`, the host's own voice match) to `device.input` from audio, as a guess for context, never proof. An invalid one is dropped. A plain string works as before.
- The device-initiated profile allows a private network address for devices that cannot join a tailnet, such as the ESP32 board. That connection is not encrypted, so it carries only `device.health` and `display.text`; the controller refuses everything else and closes on `input` or `audio`. Accepting these connections is optional, and the reference listener still binds only loopback and Tailscale.
- ESP32 client: it logs a frame it drops (over 16 KiB, or the queue full) and an NVS erase that loses the device key, instead of staying silent. The controller-silence timer is 32 bits, so the main task can't read it half-written.
- ESP32 client (experimental, `clients/embedded/esp32`): ESP-IDF firmware that connects out to its controller over Wi-Fi, keeps its Ed25519 key in NVS (encrypted on S2, S3, C3 and C6), and answers `device.health` and, with a board screen, `display.text`. Its protocol core is tested against the SDK on a computer; the firmware is not yet tested on a board.
- Device input can carry `via`, the voice assistant that relayed the person's words, such as `siri`. The controller passes it on with `device.input`, so the agent knows the assistant reads its first reply aloud and there may be no follow-up. Older controllers refuse an input with `via`, so a device sends it only to a controller that has this version.
- The `agent-devices` skill says how to answer work handed over by your cerebellum, your fast voice (AI Maestro F100): do it, then answer with `SendMessage`, short and spoken.
- The kiosk sends `device.used` the moment a person taps the mic, before the recording, so a controller can get ready while they speak (AI Maestro F100 warms the agent's speaking side on it).
- The `agent-devices` skill says how to talk to a person at a device: answer at once without reading the inbox, and speak like a person, in short sentences with no paths, IDs, links, code or long numbers. The rule lives in the skill because the message itself is untrusted text.
- The hub tells `transcribe` whose clip it is: `transcribe(audio, { agent, device })`, so a host can hear each agent's devices the way that agent chose.
- An activity update can carry `hearing`, the speech service that hears the device, and the kiosk shows it under Microphone: "What you say is heard by ElevenLabs".
- The hub accepts a device whose socket sends the hub's own `Origin`, as iOS and Android socket libraries always do. Before, it dropped them with no log, so a phone could never connect. Any other `Origin` is still dropped, and now logged as a refusal.
- The kiosk's icon column is tighter and centred between the person's wave and the bottom of the screen.
- The kiosk settings no longer call every agent "her" or "she".
- Captions button on the kiosk: a small menu turns the agent's words and the person's words on or off, remembered on that screen.
- The bridge runs on macOS for your own Mac: `clients/linux/platform.mjs` holds the hardware commands.
- An activity update can carry `label`, the agent's display name, so a device shows "Lola" and not `pas-lola`.
- New kiosk page: the agent's voice and words above, the person's picture, voice and words below, with Outfit served from the device. Tap to talk, typing, four grant switches and real voice levels (`/levels`). `Use this device` is gone: talking or typing counts.
- Security: the local stop and the Camera switch now also turn off `camera`. Before, still pictures still worked after "Stop & revoke media". The local stop covers every grant.
- Talking stops the agent's speech at once: during a talk session `speaker.play` and `speaker.say` return `played:false`, so the microphone does not pick her up.
- Local camera preview on loopback, with `ADP_PREVIEW=off` for slow devices. It never reaches the agent.
- Hold to talk: a person holds a control on the device, and the recording reaches the controller as a signed `audio` event.
- A jump to the device already active changes nothing. Before, a person typing at a device cancelled what the agent was doing there.
- A controller says why it refused a device connection, and a device stops on a final refusal instead of retrying forever (#22).
- `serve` can also connect out with `ADP_CONTROLLER`, so a device keeps live media and gains device input.
- `speaker.play`: the device plays WAV audio the controller made, with its own grant, so an agent keeps one voice on every device.
- The `agent-devices` skill and `adp-device.sh`, the agent's command.
- Display: render only when the state changes, bound presence and control requests, and reload an idle kiosk after six hours while #20 is open.

## [0.1.0] - 2026-11-06 - Public debut

First public release of the Agent Device Protocol (ADP), under the MIT license.

- Protocol v1: signed registration, discovery and invocation; typed capabilities; owner-defined capabilities; local grants; a required in-use sign for cameras and microphones.
- Controller role: one process can serve many agents; an agent owns zero or more devices and is active on at most one.
- Device-opened connections.
- Locally approved ownership and permission changes.
- SDK, Linux bridge, reference controller, and a conformance suite for any controller.
