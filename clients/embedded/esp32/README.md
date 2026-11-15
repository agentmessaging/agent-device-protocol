# ESP32 client (experimental)

A small ESP32 board as an agent device. It opens the [outbound connection](../../../protocol/reverse.md) to its controller over Wi-Fi, signs with its own Ed25519 key, and answers:

- `device.health`: `{status:"ok", platform:"esp32s3"}` (the chip name).
- `display.text`, only when you turn it on and your board port shows the text (see below).

Nothing else is advertised: no camera, microphone, speaker, activity events, device input or locally approved transfers.

Status: the protocol core (`main/adp.c`) is tested on a computer against the SDK (`tests/esp32-client.test.mjs`). The firmware around it (`main/main.c`) has not been compiled or run on a board yet.

## Why ESP-IDF

ESP-IDF has encrypted NVS, menuconfig for settings that stay out of Git, and managed components for the three libraries this needs: `espressif/libsodium` (Ed25519), `espressif/cjson` and `espressif/esp_websocket_client`. The same libsodium and cJSON run on a computer, so the test compiles the board's own protocol code. Arduino-ESP32 ships a prebuilt ESP-IDF configuration, so encrypted NVS cannot be turned on there.

## Boards

Any ESP32-family chip with Wi-Fi that ESP-IDF 5.1 or later supports. It needs about 1.5 MB of flash for the app, so use a 4 MB board.

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

## Showing text

Turn on **Offer display.text** in menuconfig and add this function to your board port (a new file in `main/`, added to `main/CMakeLists.txt`):

```c
int adp_board_show_text(const char *text, void *user);  // return 0 when the text is shown
```

The text is up to 4096 bytes of UTF-8 and is literal text, never markup. Without this function the build fails on purpose, so the board never offers a screen it does not have. Turning the option on is the owner's local grant for `display.text`.

## Limits

- **Transport.** The board connects with plain `ws://`. The protocol profile expects Tailscale to encrypt this link, and a board cannot run Tailscale. Every request and answer is still signed and uses one-use challenges, so no one on the network can act as the controller or the device, but people on the same network can read what is sent (for example, text for the screen). The reference listener binds only loopback and Tailscale addresses, so the board also needs a network route to that address. This is open question 1 below.
- **Frame size.** Frames larger than 16 KiB are dropped. The controller then waits 15 seconds for the call to time out.
- **Memory.** At most 8 outstanding challenges (the HTTP profile allows 512), one call at a time, and each call is answered before the next frame is read.
- **Ownership.** Owner and agent come from the flashed config. A transfer means flashing new config. `revision` is a new random value on each boot.
- **Not tested on hardware.** Wi-Fi, NVS, encrypted NVS, the WebSocket client, refusal handling and reconnect timing have not been run on a board.

## Open protocol questions

These are written down here rather than changed in `protocol/`:

1. **Transport for boards without Tailscale.** Should the profile allow a private LAN address, or `wss://` with a pinned certificate, for devices that cannot join a tailnet? Today the board's link is signed but not encrypted.
2. **Device size limits.** There is no field for a device to say how large a request it accepts. Should `register` carry a limit (for example `maxRequestBytes`) so a controller can refuse early instead of timing out?
3. **Refusal header.** `esp_websocket_client` gives the HTTP status of a refused upgrade but not the `X-ADP-Refusal` header. The board treats HTTP 403 as `unknown_device` (final) and any other status as temporary. Should the status alone be enough?
4. **Revision without local approval.** `revision` is described for locally approved changes. What should a device that has no proposals and no persistent revision send?
5. **Challenge pool size.** The HTTP profile says at most 512 outstanding challenges. Is a smaller pool, answered with 429 when full, conformant for the outbound profile?
