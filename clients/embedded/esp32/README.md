# ESP32 client (experimental)

A small ESP32 board as an agent device. It opens the [outbound connection](../../../protocol/reverse.md) to its controller over Wi-Fi, signs with its own Ed25519 key, and answers:

- `device.health`: `{status:"ok", platform:"esp32s3"}` (the chip name).
- `display.text`, only when you turn it on and your board port shows the text (see below).
- `camera.snapshot`, on a Seeed XIAO ESP32-S3 Sense with the camera option on and the encrypted connection (see below).
- `speaker.play`, through a MAX98357A amplifier, and a talk button that sends what a person says as an `audio` event (see below). Encrypted connection only.

Nothing else is advertised: no activity events, typed input or locally approved transfers.

Status: the protocol core (`main/adp.c`) is tested on a computer against the SDK (`tests/esp32-client.test.mjs`), and the talk button's end-of-speech logic (`main/vad.c`) on synthetic audio (`tests/esp32-vad.test.mjs`). On a Seeed XIAO ESP32-S3 Sense with a MAX98357A, against an SDK hub at a home network address: the encrypted connection, discovery, health, snapshots, talk (speech-to-text of the clip matched the spoken sentence), and speaker playback that people can understand.

## Why ESP-IDF

ESP-IDF has encrypted NVS, menuconfig for settings that stay out of Git, and managed components for the three libraries this needs: `espressif/libsodium` (Ed25519), `espressif/cjson` and `espressif/esp_websocket_client`. The same libsodium and cJSON run on a computer, so the test compiles the board's own protocol code. Arduino-ESP32 ships a prebuilt ESP-IDF configuration, so encrypted NVS cannot be turned on there.

## Boards

Any ESP32-family chip with Wi-Fi that ESP-IDF 5.1 or later supports. It needs about 1.5 MB of flash for the app, so use a 4 MB board. A Seeed XIAO ESP32-S3 needs its external antenna attached: without it the board sees the access point but every join attempt times out at `auth -> init`.

| Chip | Device key storage |
| --- | --- |
| ESP32-S2, S3, C3, C6 | Encrypted NVS by default (`sdkconfig.defaults.<chip>`). The key that protects it comes from an eFuse HMAC key. On first boot the firmware burns a random key into eFuse block 0 if that block is free. This cannot be undone; change `CONFIG_NVS_SEC_HMAC_EFUSE_KEY_ID` if block 0 is in use. |
| ESP32 (original) | Plain NVS. Encrypted NVS on this chip needs flash encryption, which this client does not set up. Anyone holding the board can read its key, and the board logs a warning at boot. |

## Build and flash

Install [ESP-IDF](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/get-started/) 5.1 or later, then:

```bash
cd clients/embedded/esp32
idf.py set-target esp32s3            # your chip
idf.py menuconfig                    # Agent Device Protocol menu
idf.py build flash monitor
```

In the **Agent Device Protocol** menu set:

- Wi-Fi network name and password.
- Encrypted connection (on by default): connect through `/v1/secure` (S003). Turn it off only for a controller that does not implement S003.
- Controller address: `ws://IPV4:PORT` of the controller's outbound listener, for example `ws://100.64.0.10:23112`. Only loopback, Tailscale (`100.64.0.0/10`) and private LAN addresses are accepted. No DNS names.
- Controller public key: the owning agent's key.
- Owning agent's full AMP address, for example `assistant@acme.aimaestro.local`.

These go into `sdkconfig`, which Git ignores. Do not commit it: it holds your Wi-Fi password.

## Pair with a controller

1. On the controller host, get the agent's controller key: `node apps/controller/cli.mjs init` prints it.
2. Put that key and the agent's address in menuconfig, then flash.
3. The serial monitor prints `Device public key (safe to share): ...`. The key is created on first boot and kept in NVS.
4. Pin it on the controller and start the listener:

   ```bash
   node apps/controller/cli.mjs add-outbound desk-board DEVICE_PUBLIC_KEY assistant@acme.aimaestro.local http://100.64.0.10:23112
   node apps/controller/cli.mjs listen http://100.64.0.10:23112
   ```

5. The board connects. `discover` and `device.health` work at once; `display.text` also needs the agent to jump to the board, like any output.

Pairing is local, as the protocol requires: the board trusts only the controller key flashed into it, and the controller trusts only the device key you pinned.

## Camera (XIAO ESP32-S3 Sense)

Build with the board's settings file, which turns on the 8 MB octal PSRAM, the 8 MB flash and the camera:

```bash
idf.py -D SDKCONFIG_DEFAULTS="sdkconfig.defaults;sdkconfig.defaults.xiao-s3-sense" set-target esp32s3
idf.py menuconfig    # Wi-Fi and controller, as above
idf.py build flash monitor
```

The **Offer camera.snapshot** option is the owner's local grant for the camera. The board offers `camera.snapshot` only when the option is on, the connection is encrypted, and the camera answered at boot. The user LED is the capture sign: it goes on before the camera starts, the camera runs only for the picture (the sensor is stopped between pictures), and the LED stays on three seconds after it. The answer is `{mime:"image/jpeg",data:"<standard base64>"}`, 1024×768, at most 1 MiB. A picture takes about 2.5 seconds, mostly the camera starting and letting its exposure settle.

## Doctor (XIAO ESP32-S3 Sense)

Turn on **Check the hardware at boot** (`ADP_DOCTOR`) to test the parts before the board connects. It prints one line per part to the USB console (`idf.py monitor`). A real run:

```
DOCTOR chip       PASS esp32s3 rev 0.2, 2 cores, flash 8 MB
DOCTOR psram      PASS 8192 KB, 8189 KB free; internal RAM 232 KB free
DOCTOR led        INFO blinked three times: a person must confirm it
DOCTOR wifi       PASS Pelamecha, 10.0.0.107, signal -47 dBm
DOCTOR controller PASS 10.0.0.79:23112 accepts connections
DOCTOR microphone PASS room level -37.7 dBFS, peak 722
DOCTOR speaker    PASS 1 kHz tone 48.7 dB above the room at the microphone
DOCTOR camera     PASS 23030 byte JPEG in 771 ms
```

The speaker check plays a 1.5 second 1 kHz tone and passes when the microphone hears it at least 20 dB above the room (electrical noise from the speaker wires alone reached 15 dB in testing). Run it three times: a result that changes between runs is a loose wire. The LED is on while the microphone or the camera runs. Nothing recorded leaves the board.

The doctor build is also a debug build. With **Also send logs over Wi-Fi to** (`ADP_LOG_HOST`, for example `10.0.0.79:5514`) every log line also goes out as UDP, and the USB console takes three test commands: `talk` starts a recording as the talk button does, `hear` records 6 seconds without stopping the speaker, so the board records its own playback, and `vol N` sets the speaker volume to N% until the next restart, to find the loudest clean level by ear. `talk` and `hear` run under the LED sign. All three need the USB cable.

Louder speech without distortion: compress the speech before sending it rather than raising the volume. On the test board, speech compressed to peaks at -1 dBFS (about 8 dB louder on average) was clean at 12%; at 25% and above it distorted, most likely because the amplifier's supply (the XIAO's USB 5V over jumper wires) sags on loud parts. A 470 µF capacitor across the amplifier's VIN and GND and short wires are the next things to try.

## Talk button and speaker (XIAO ESP32-S3 Sense)

Turn on **Microphone and talk button** (`ADP_MICROPHONE`) and **Offer speaker.play** (`ADP_SPEAKER`); each is the owner's grant. Both need the encrypted connection.

- **Talk:** press BOOT (the button marked B; another pin with `ADP_TALK_GPIO`) and speak. The LED is bright while the microphone runs. Recording ends one second after you stop, at a second press, or at 20 seconds, and goes to the controller as one signed `audio` event (16 kHz mono WAV). Nothing is sent if nobody speaks within 5 seconds. A clip the controller cannot take within 10 seconds is dropped, never replayed. End of speech uses a high-pass filter and the quietest recent frames as the room level, so a fan or the microphone's slow drift does not count as speech.
- **Speaker:** `speaker.play` takes a 16-bit PCM WAV, mono or stereo, 8 to 48 kHz, up to 384 KiB, and plays it to the end. A talk press stops it with `{played:false}`. Volume is `ADP_SPEAKER_VOLUME` (12% by default).

Wire a MAX98357A amplifier to the XIAO. The XIAO's pin labels are printed on the underside, which is a mirror image of the top, so check each pin by its label:

| MAX98357A | XIAO |
| --- | --- |
| VIN | 5V |
| GND | GND |
| SD | 3V3: many boards stay shut down with SD unconnected |
| GAIN | unconnected (9 dB) |
| DIN | D5 (GPIO6) |
| BCLK | D1 (GPIO2) |
| LRC | D4 (GPIO5) |

Pins are menuconfig options; these avoid the camera, the microphone (GPIO41/42) and the microSD slot (D8–D10). What we hit, in order: a shorted speaker made the Wi-Fi drop packets (the amplifier pulled the supply down); wires on the wrong side of the board gave silence; loose jumper wires gave noise and a speaker check that passed one run and failed the next; and at full volume speech was noise on USB power. Seat the wires firmly (or solder them), keep the volume at 12%, and a 100–470 µF capacitor across the amplifier's VIN and GND allows more.

## Listening for a wake phrase (XIAO ESP32-S3 Sense)

With **Listen for a wake phrase** (`ADP_LISTEN`, the owner's listen grant from [S004](../../../docs/wiki/specs/S004-wake-phrase-listening.md)) the board needs no button. The microphone runs all the time through a local detector, and the LED is dim while it listens. When it hears the phrase, the LED goes bright and the board records what the person says next, as the talk button does; nothing is sent if nobody speaks within 5 seconds. After the agent's speech ends, the board waits up to 8 seconds for an answer without the phrase. The register says `permissions.listen: true` and `wakePhrase`.

- **The model** is a microWakeWord `.tflite` file that you train (`ADP_WAKE_MODEL`, an absolute path; it is built into the firmware and is not in this repository). Set `ADP_WAKE_PHRASE` to what it detects and `ADP_WAKE_CUTOFF` to the cutoff the training reported.
- The detector keeps no audio. A 480 ms ring of microphone audio is kept in RAM, so words said right after the phrase are in the clip (the detector decides about half a second after the phrase ends).
- The board has no echo cancellation, so detection pauses while it plays.
- The firmware needs the 4 MB app partition of `partitions-8mb.csv` (set by `sdkconfig.defaults.xiao-s3-sense`); nvs stays where it was, so the device key survives the change.
- The PDM microphone is about 24 dB quieter than recordings, so the detector gets the same low cut and a 16x gain as a recording.

On the board (2026-11-23): "Hey Bruce" from a Mac voice was detected at 59 to 74%, a person's "Hi Bruce, are you there" at 62%, and the clip after the phrase was transcribed exactly ("Are you there?", "Can you tell me a story about the dragon?"). Scores are near the cutoff: a model trained with audio from the board's own microphone is the next step.

Testing with a controller that plays back every clip makes a loop with the answer window: play nothing back, or turn listening off.

## Wi-Fi networks and a relay (a board that travels)

- **Several networks** ([S005](../../../docs/wiki/specs/S005-device-networks.md)). The board keeps up to 8 networks in NVS and joins the strongest one it knows; the network set in menuconfig is always one of them. With **Let the controller add and remove Wi-Fi networks** (`ADP_NETWORKS`, the owner's network grant) the controller can call `network.add`, `network.remove` and `network.list` over the encrypted connection. Passwords are never sent back or logged. The list is erased when the controller key or agent changes. Turn on NVS encryption (the XIAO's HMAC scheme): the passwords are stored in NVS.
- **Setup mode** (`ADP_SETUP_MODE`, on in `sdkconfig.defaults.xiao-s3-sense`). After about 30 seconds with none of its networks in range, the board opens Espressif's provisioning over Bluetooth LE (security 2, SRP6a) for 10 minutes, under a slow blink of the LED. Its name is `ADP_` and the first 8 characters of the device key; the setup code is made at first start, kept in NVS, and printed only on the USB console (`Setup mode: Bluetooth name …, setup code …`). A phone sends one network with Espressif's provisioning client (the AI Maestro app later; for a test, `tools/esp_prov/esp_prov.py --transport ble --service_name ADP_… --sec_ver 2 --sec2_username wifiprov --sec2_pwd CODE --ssid NAME --passphrase …`). On macOS the terminal needs Bluetooth permission.
- **A relay** ([S006](../../../docs/wiki/specs/S006-public-relay.md)). **Controller address through a relay** (`ADP_RELAY_URL`, `wss://NAME`) is tried after the controller address, so the board reaches its controller from any network through, for example, a Cloudflare tunnel to the controller's relay listener. The certificate is checked against the ESP-IDF certificate bundle; the encrypted connection runs inside. The controller address may be left empty when only the relay is used.


Turn on **Offer display.text** in menuconfig and add this function to your board port (a new file in `main/`, added to `main/CMakeLists.txt`):

```c
int adp_board_show_text(const char *text, void *user);  // return 0 when the text is shown
```

The text is up to 4096 bytes of UTF-8 and is literal text, never markup. Without this function the build fails on purpose, so the board never offers a screen it does not have. Turning the option on is the owner's local grant for `display.text`.

## Limits

- **Transport.** By default the board connects to `ws://IPV4:PORT/v1/secure/DEVICE_KEY`, the encrypted connection of [S003](../../../docs/wiki/specs/S003-encrypted-home-network-connection.md): it answers only a signed `secure.hello`, sends a signed `secure.accept` with a new X25519 key, and after that reads and sends only ChaCha20-Poly1305 binary messages. It never falls back to a plain connection; when the controller refuses `/v1/secure`, it retries later. With the option off it uses plain `/v1/connect`, which [reverse.md](../../../protocol/reverse.md#home-network-connections) limits to `device.health` and `display.text` from a home network address, and people on the same network can read the screen text. Either way the controller must listen on an address the board can reach: the reference listener binds only loopback and Tailscale, and AI Maestro needs `AIMAESTRO_DEVICE_HOME_ADDRESS`.
- **Frame size.** Frames larger than 16 KiB are dropped (about 1 MiB with the speaker on). The controller then waits 15 seconds for the call to time out.
- **Memory.** At most 8 outstanding challenges (the HTTP profile allows 512), one call at a time, and each call is answered before the next frame is read.
- **Ownership.** Owner and agent come from the flashed config. A transfer means flashing new config. `revision` is a new random value on each boot.
- **Partly tested on hardware.** On a XIAO ESP32-S3 Sense (OV3660) with a MAX98357A: Wi-Fi, encrypted NVS, key creation, the encrypted connection to an SDK hub at a home network address, discovery, health, snapshots, talk and speaker. Refusal handling and reconnect timing have not been run on a board, nor a session with AI Maestro.
- **No local stop yet.** Turning the camera, microphone or speaker off means flashing with the option off.

## Open protocol questions

These are written down here rather than changed in `protocol/`:

1. **Encrypted transport for boards without Tailscale.** Answered by [S003](../../../docs/wiki/specs/S003-encrypted-home-network-connection.md). The firmware uses it by default.
2. **Device size limits.** There is no field for a device to say how large a request it accepts. Should `register` carry a limit (for example `maxRequestBytes`) so a controller can refuse early instead of timing out?
3. **Refusal header.** `esp_websocket_client` gives the HTTP status of a refused upgrade but not the `X-ADP-Refusal` header. The board treats HTTP 403 as `unknown_device` (final) and any other status as temporary. Should the status alone be enough?
4. **Revision without local approval.** `revision` is described for locally approved changes. What should a device that has no proposals and no persistent revision send?
5. **Challenge pool size.** The HTTP profile says at most 512 outstanding challenges. Is a smaller pool, answered with 429 when full, conformant for the outbound profile?
