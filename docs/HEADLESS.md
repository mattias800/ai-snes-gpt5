# Headless runner and PNG screenshots

This repository includes a simple headless runner to execute the emulator for a number of frames and dump a PNG screenshot of the main screen buffer using pngjs.

APU shim (env-gated)
- To aid development without a full SPC700, you can enable a minimal APU shim via environment flags. These only affect behavior when explicitly enabled; by default, nothing changes.
  - SMW_APU_SHIM=1: enable the shim.
  - SMW_APU_SHIM_UNBLANK=0|1: if 1 (default), the shim clears forced blank and enables BG1 after the initial handshake.
  - SMW_APU_SHIM_TILE=0|1: if 1 (default), the shim injects a small BG1 tile and a red palette entry to guarantee a visible pixel for CI and debugging.

These flags are intended only for development and automated verification with a commercial ROM; the rest of the tests are independent and deterministic.

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
   - --debug=0|1: print PPU and memory stats, plus a simple output sanity metric
   - --forceUnblank=0|1: manually clear forced blank and set brightness before capture
   - --forceEnableBG1=0|1: manually enable BG1 on the main screen before capture
   - --autoFallback=0|1: inject a minimal BG1 tile and palette if the ROM hasn’t drawn yet (default: 1)

   Relevant environment variables:
   - SMW_ROM: default ROM path
   - SMW_APU_SHIM, SMW_APU_SHIM_UNBLANK, SMW_APU_SHIM_TILE: see APU shim notes above
   - SMW_FRAMES, SMW_IPS: defaults for frames and scheduler IPS
   - SMW_CPUERR: default onCpuError behavior (ignore|throw|record)

Implementation details
- Loads the ROM via normaliseRom + parseHeader to detect mapping.
- Boots the Emulator via Emulator.fromCartridge(cart).
- Uses Scheduler to step frames deterministically; on CPU error, throws.
- Renders a main-screen RGBA buffer via renderMainScreenRGBA(ppu, w, h).
- Writes PNG using pngjs.

Notes
- This runner builds upon the same primitives used by env-gated SMW snapshot tests.
- It does not require a browser or canvas; it is fully headless.

