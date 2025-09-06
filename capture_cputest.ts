import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { normaliseRom } from './src/cart/loader';
import { parseHeader } from './src/cart/header';
import { Cartridge } from './src/cart/cartridge';
import { Emulator } from './src/emulator/core';
import { Scheduler } from './src/emulator/scheduler';
import { renderMainScreenRGBA } from './src/ppu/bg';

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

// Run for approximately 5 hardware seconds (300 frames at 60fps)
console.log('Running cputest-full.sfc for ~5 seconds...');
for (let i = 0; i < 300; i++) {
  sched.stepFrame();
  if (i % 50 === 0) {
    console.log(`Frame ${i}/300`);
  }
}

// Capture screenshot
const width = 256;
const height = 224;
const rgba = renderMainScreenRGBA(emu.bus.getPPU(), width, height);

// Save as PNG
const outDir = 'artifacts/screens';
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'cputest_full_1sec.png');

const png = new PNG({ width, height });
Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength).copy(png.data);

const stream = fs.createWriteStream(outPath);
png.pack().pipe(stream);

stream.on('finish', () => {
  console.log(`Screenshot saved to: ${outPath}`);
  
  // Also check what's on screen by reading some tilemap data
  const ppu = emu.bus.getPPU() as any;
  
  // Read the "Test number:" label at the expected location
  const chars: number[] = [];
  const ROW_TESTNUM = 0x0061;
  for (let i = 0; i < 16; i++) {
    const w = ppu.inspectVRAMWord((ROW_TESTNUM + i) & 0x7fff) & 0xffff;
    chars.push(w & 0xff);
  }
  const text = String.fromCharCode(...chars).replace(/\0/g, ' ');
  console.log(`Text at test row: "${text}"`);
  
  // Check for any visible tile data in the character base
  // BG12NBA shows BG1 tiles at 0x4000 (nibble 4 * 0x1000)
  const tileBase = 0x4000 / 2; // Convert byte address to word address = 0x2000
  let hasData = false;
  let nonZeroCount = 0;
  for (let i = 0; i < 256; i++) {  // Check more words
    const w = ppu.inspectVRAMWord((tileBase + i) & 0x7fff) & 0xffff;
    if (w !== 0) {
      hasData = true;
      nonZeroCount++;
    }
  }
  console.log(`Tile graphics present at 0x${(tileBase*2).toString(16)}: ${hasData} (${nonZeroCount} non-zero words in first 256)`);
  
  // Also check the originally expected location
  const altBase = 0x0800 / 2; // 0x400 words
  let altHasData = false;
  for (let i = 0; i < 32; i++) {
    const w = ppu.inspectVRAMWord((altBase + i) & 0x7fff) & 0xffff;
    if (w !== 0) {
      altHasData = true;
      break;
    }
  }
  console.log(`Tile graphics present at 0x0800: ${altHasData}`);
  
  // Read PPU status registers
  const bg1sc = ppu.regs[0x07] || 0;
  const bg12nba = ppu.regs[0x0b] || 0;
  const tm = ppu.regs[0x2c] || 0;
  const inidisp = ppu.regs[0x00] || 0;
  
  console.log(`PPU Status:`);
  console.log(`  INIDISP: 0x${inidisp.toString(16).padStart(2, '0')} (brightness: ${inidisp & 0x0f}, blanked: ${(inidisp & 0x80) ? 'yes' : 'no'})`);
  console.log(`  BG1SC: 0x${bg1sc.toString(16).padStart(2, '0')} (tilemap at: 0x${((bg1sc >> 2) * 0x800).toString(16)})`);
  console.log(`  BG12NBA: 0x${bg12nba.toString(16).padStart(2, '0')} (BG1 tiles at: 0x${((bg12nba & 0x0f) * 0x1000).toString(16)})`);
  console.log(`  TM: 0x${tm.toString(16).padStart(2, '0')} (BG1 enabled: ${(tm & 0x01) ? 'yes' : 'no'})`);
});

stream.on('error', (err) => {
  console.error('Failed to save screenshot:', err);
  process.exit(1);
});
