# Headless runner and PNG screenshots

This repository includes a simple headless runner to execute the emulator for a number of frames and dump a PNG screenshot of the main screen buffer using pngjs.

Requirements
- Node.js (ESM-enabled; this repo sets "type": "module").
- devDependencies installed (pnpm i / npm i). The runner uses:
  - ts-node (ESM loader)
  - pngjs

Script
- scripts/headless_screenshot.ts — runs the emulator headlessly and saves an RGBA frame as a PNG.

Usage
1) Install dev dependencies (once):
   npm install

2) Run the screenshot command (SMW_ROM can be used instead of --rom):
   npm run screenshot -- --rom=/path/to/SMW.sfc --out=./out.png --frames=180 --ips=200 --width=256 --height=224 --holdStart=1

   Flags:
   - --rom: path to ROM file (required unless SMW_ROM env var is set)
   - --out: output PNG path (default: screenshot.png)
   - --frames: number of frames to simulate (default: 180 or SMW_FRAMES env)
   - --ips: instructions per scheduler slice (default: 200 or SMW_IPS env)
   - --width, --height: output dimensions (default: 256x224)
   - --holdStart: whether to hold Start during run for deterministic boot behavior (default: 1)

Implementation details
- Loads the ROM via normaliseRom + parseHeader to detect mapping.
- Boots the Emulator via Emulator.fromCartridge(cart).
- Uses Scheduler to step frames deterministically; on CPU error, throws.
- Renders a main-screen RGBA buffer via renderMainScreenRGBA(ppu, w, h).
- Writes PNG using pngjs.

Notes
- This runner builds upon the same primitives used by env-gated SMW snapshot tests.
- It does not require a browser or canvas; it is fully headless.

