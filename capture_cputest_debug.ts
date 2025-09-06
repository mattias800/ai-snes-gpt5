import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { normaliseRom } from './src/cart/loader';
import { parseHeader } from './src/cart/header';
import { Cartridge } from './src/cart/cartridge';
import { Emulator } from './src/emulator/core';
import { Scheduler } from './src/emulator/scheduler';
import { renderMainScreenRGBA } from './src/ppu/bg';

// Enable MMIO logging to see DMA activity
process.env.SMW_LOG_MMIO = '1';
process.env.SMW_LOG_FILTER = '0x420b,0x4300,0x4301,0x4302,0x4303,0x4304,0x4305,0x4306';
process.env.SMW_LOG_LIMIT = '100';

// Boot the ROM
const romPath = 'test-roms/snes-tests/cputest/cputest-full.sfc';
const raw = fs.readFileSync(romPath);
const { rom } = normaliseRom(new Uint8Array(raw));
const header = parseHeader(rom);
const cart = new Cartridge({ rom, mapping: header.mapping });
const emu = Emulator.fromCartridge(cart);
emu.reset();

// Create scheduler with higher IPS for faster execution
const sched = new Scheduler(emu, 1000, { onCpuError: 'throw' });

// Run for approximately 2 seconds (120 frames) to see early DMA activity
console.log('Running cputest-full.sfc for ~2 seconds with MMIO logging...');
console.log('Looking for DMA activity...\n');
for (let i = 0; i < 120; i++) {
  sched.stepFrame();
  if (i % 30 === 0) {
    console.log(`\n=== Frame ${i}/120 ===`);
  }
}

// Capture screenshot
const width = 256;
const height = 224;
const rgba = renderMainScreenRGBA(emu.bus.getPPU(), width, height);

// Save as PNG
const outDir = 'artifacts/screens';
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'cputest_full_debug.png');

const png = new PNG({ width, height });
Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength).copy(png.data);

const stream = fs.createWriteStream(outPath);
png.pack().pipe(stream);

stream.on('finish', () => {
  console.log(`\nScreenshot saved to: ${outPath}`);
  
  // Check VRAM state
  const ppu = emu.bus.getPPU() as any;
  
  // Check tile data at 0x4000
  const tileBase = 0x4000 / 2;
  let hasData = false;
  for (let i = 0; i < 256; i++) {
    const w = ppu.inspectVRAMWord((tileBase + i) & 0x7fff) & 0xffff;
    if (w !== 0) {
      hasData = true;
      break;
    }
  }
  console.log(`\nTile graphics present at 0x4000: ${hasData}`);
  
  // Read text from tilemap
  const chars: number[] = [];
  const ROW_TESTNUM = 0x0061;
  for (let i = 0; i < 16; i++) {
    const w = ppu.inspectVRAMWord((ROW_TESTNUM + i) & 0x7fff) & 0xffff;
    chars.push(w & 0xff);
  }
  const text = String.fromCharCode(...chars).replace(/\0/g, ' ');
  console.log(`Text at test row: "${text}"`);
});

stream.on('error', (err) => {
  console.error('Failed to save screenshot:', err);
  process.exit(1);
});
