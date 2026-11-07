# macOS client

The Linux bridge in `clients/linux` also runs on macOS: `clients/linux/platform.mjs` picks ffmpeg's `avfoundation` for the camera and microphone, `audiotoolbox` for sound and `say` for speech. Install ffmpeg with Homebrew.

This is for your own Mac. macOS gives camera and microphone permission to the program that asks, so grant it by hand once, from a terminal. A background service may never show the prompt, so a client for other people needs a signed app.

Tested on a 2015 MacBook Air, macOS 12.7, Intel, with Node 22 and a static ffmpeg: bridge, kiosk in Chrome, FaceTime camera, microphone and hold to talk. On that machine no permission prompt was needed.
