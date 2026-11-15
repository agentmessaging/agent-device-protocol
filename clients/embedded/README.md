# Embedded clients

Implement the protocol independently of Node. Start with signed `device.health` on a board with secure key storage and a private transport. Constrain snapshot sizes to the board's memory budget.

- [ESP32](esp32/README.md) (experimental): ESP-IDF, outbound WebSocket over Wi-Fi, device key in (encrypted) NVS, `device.health` and optional `display.text`. The protocol core is tested against the SDK on a computer; the firmware is not yet tested on a board.
