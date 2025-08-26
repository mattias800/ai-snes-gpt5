import fs from 'fs';
import { PNG } from 'pngjs';
import { normaliseRom } from '../dist/cart/loader.js';
import { parseHeader } from '../dist/cart/header.js';
import { Cartridge } from '../dist/cart/cartridge.js';
import { Emulator } from '../dist/emulator/core.js';
import { Scheduler } from '../dist/emulator/scheduler.js';
import { renderMainScreenRGBA } from '../dist/ppu/bg.js';

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const romPath = args.rom || process.env.SMW_ROM;
  const outPath = args.out || 'screenshot.png';
  const frames = Number.isFinite(Number(args.frames)) ? Math.max(1, Number(args.frames)) : (Number(process.env.SMW_FRAMES) || 180);
  const ips = Number.isFinite(Number(args.ips)) ? Math.max(1, Number(args.ips)) : (Number(process.env.SMW_IPS) || 200);
  const width = Number.isFinite(Number(args.width)) ? Number(args.width) : 256;
  const height = Number.isFinite(Number(args.height)) ? Number(args.height) : 224;
  const holdStart = (args.holdStart ?? '1') !== '0';
  const cpuErrMode = (args.onCpuError) || (process.env.SMW_CPUERR) || 'record';

  if (!romPath) {
    console.error('Usage: npm run screenshot -- --rom=path/to/SMW.sfc --out=./out.png [--frames=180] [--ips=200] [--width=256] [--height=224] [--holdStart=1] [--onCpuError=record|throw|ignore]');
    process.exit(1);
  }

  console.log(`[screenshot] ROM: ${romPath}  out: ${outPath}  frames: ${frames}  ips: ${ips}  size: ${width}x${height}  holdStart=${holdStart}  onCpuError=${cpuErrMode}`);

  const raw = fs.readFileSync(romPath);
  const { rom } = normaliseRom(new Uint8Array(raw));
  const header = parseHeader(rom);
  console.log(`[screenshot] Detected mapping=${header.mapping} title="${header.title}" checksum=${header.checksum.toString(16)}`);
  const cart = new Cartridge({ rom, mapping: header.mapping });
  const emu = Emulator.fromCartridge(cart);
  emu.reset();

  const sched = new Scheduler(emu, ips, { onCpuError: cpuErrMode });
  if (holdStart) emu.bus.setController1State({ Start: true });

  try {
    for (let i = 0; i < frames; i++) {
      sched.stepFrame();
      if (i % 30 === 29) console.log(`[screenshot] stepped ${i + 1} frames`);
    }
  } catch (e) {
    console.error('[screenshot] CPU error during stepping:', e);
    if (cpuErrMode === 'throw') throw e;
  }

  const ppu = emu.bus.getPPU();
  const rgba = renderMainScreenRGBA(ppu, width, height);

  const png = new PNG({ width, height });
  const buf = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  buf.copy(png.data);

  await new Promise((resolve, reject) => {
    const s = fs.createWriteStream(outPath);
    png.pack().pipe(s);
    s.on('finish', () => resolve());
    s.on('error', (e) => reject(e));
  });

  console.log(`Wrote ${outPath} (${width}x${height}) after ${frames} frames at ${ips} ips`);
}

main().catch((e) => {
  console.error('[screenshot] Unhandled error:', e);
  process.exit(1);
});

