# Source notes: wiki and avatar references

Captured: 2026-11-06. These are concise research summaries, not copied source files. Links to mutable upstream pages may evolve; revalidate before implementation.

## Karpathy LLM Wiki

Primary source: [Andrej Karpathy's gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

The pattern separates preserved sources from maintained, linked Markdown knowledge. A schema defines conventions; an index supports navigation and an append-only log records changes. It encourages ingestion, synthesis and periodic checks for contradictions and stale material. Our internal bug IDs, priorities and spec lifecycle are project adaptations, not features of an official Karpathy backlog product.

## Muse Gadget SDK

Primary sources: [avatar recipe](https://github.com/facebookincubator/muse-gadget-sdk/blob/main/esp32/tools/muse/AVATAR_RECIPE.md), [renderer interface](https://github.com/facebookincubator/muse-gadget-sdk/blob/main/esp32/tools/muse/avatar_prompt.md), [board integration](https://github.com/facebookincubator/muse-gadget-sdk/blob/main/esp32/devices/AGENTS.md).

The public ESP32 example renders a character locally. Its recipe can generate a custom C renderer and compile it into firmware. The renderer takes state, time and audio level, draws a small logical image and scales it for the device. Board-specific display support remains necessary. This supports shared character identity with device-specific rendering, but does not prove that every Meta app uses the same assets or renderer. Meta's default character artwork has separate rights from the SDK code.

Our proposal uses this architectural separation, not Muse wire compatibility, copied artwork or remotely installed renderer code. Package formats, limits and acceptance targets in S001 are our proposed design choices.
