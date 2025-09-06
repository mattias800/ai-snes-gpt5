import * as fs from 'fs';
import { normaliseRom } from './src/cart/loader.js';
import { parseHeader } from './src/cart/header.js';
import { Cartridge } from './src/cart/cartridge.js';
import { Emulator } from './src/emulator/core.js';
import { Scheduler } from './src/emulator/scheduler.js';

const ROM_PATH = './test-roms/snes-tests/cputest/cputest-full.sfc';

// Load ROM
const raw = fs.readFileSync(ROM_PATH);
const { rom } = normaliseRom(new Uint8Array(raw));
const header = parseHeader(rom);
const cart = new Cartridge({ rom, mapping: header.mapping });

// Create emulator
const emu = Emulator.fromCartridge(cart);
const bus = emu.bus as any;
const ppu = bus.getPPU() as any;

// Track VRAM state
let vramClears = 0;
let fontDataLoaded = false;
let fontDataCleared = false;
const fontCheckAddresses = [0x520, 0x528, 0x530]; // Addresses for 'R', 'u', 'n' tiles

// Remove tracing hooks to avoid conflicts

emu.reset();

// Create scheduler
const sched = new Scheduler(emu, 1000, { onCpuError: 'throw' });

console.log('Tracing VRAM initialization...\n');

// Run for a few frames to see the initialization sequence
const FRAMES = 10;
for (let frame = 0; frame < FRAMES; frame++) {
  console.log(`\nFrame ${frame}:`);
  
  sched.stepFrame();
  
  // Check if font tiles are present
  const vram = ppu.vram as Uint16Array;
  let hasFontData = false;
  for (const addr of fontCheckAddresses) {
    if (vram[addr] !== 0) {
      hasFontData = true;
      break;
    }
  }
  
  // Check tilemap
  const bg1MapBase = ppu.bg1MapBaseWord || 0x0400;
  let tilemapNonZero = 0;
  for (let i = 0; i < 32 * 32; i++) {
    if (vram[bg1MapBase + i] !== 0) {
      tilemapNonZero++;
    }
  }
  
  console.log(`  Font data present: ${hasFontData}`);
  console.log(`  Tilemap non-zero entries: ${tilemapNonZero}`);
  console.log(`  BG1 char base: 0x${ppu.bg1CharBaseWord.toString(16).padStart(4, '0')}`);
  console.log(`  BG1 map base: 0x${ppu.bg1MapBaseWord.toString(16).padStart(4, '0')}`);
  
  // Sample some font tile data
  if (frame === 0 || frame === FRAMES - 1) {
    console.log('  Sample font tiles:');
    for (const [char, tileIdx] of [['R', 0x52], ['u', 0x75], ['n', 0x6e]] as const) {
      const addr = tileIdx * 8; // 2bpp = 8 words per tile
      let hasData = false;
      for (let w = 0; w < 8; w++) {
        if (vram[addr + w] !== 0) {
          hasData = true;
          break;
        }
      }
      console.log(`    '${char}' (tile 0x${tileIdx.toString(16)}): ${hasData ? 'present' : 'missing'}`);
    }
  }
}

console.log('\n=== Summary ===');
console.log(`Font data loaded: ${fontDataLoaded}`);
console.log(`Font data cleared: ${fontDataCleared}`);
console.log(`VRAM clears to font area: ${vramClears}`);

// Final VRAM analysis
const vram = ppu.vram as Uint16Array;
let nonZeroTiles = 0;
for (let tile = 0; tile < 512; tile++) {
  const addr = tile * 8;
  let hasData = false;
  for (let w = 0; w < 8 && addr + w < vram.length; w++) {
    if (vram[addr + w] !== 0) {
      hasData = true;
      break;
    }
  }
  if (hasData) nonZeroTiles++;
}

console.log(`Non-zero tiles in VRAM: ${nonZeroTiles}/512`);

// Check if the ROM has font data embedded
console.log('\nChecking ROM for font data...');
const fontPatterns = [
  [0x3C, 0x42, 0x42, 0x7E, 0x42, 0x42, 0x42, 0x00], // 'A'
  [0x7C, 0x42, 0x42, 0x7C, 0x42, 0x42, 0x7C, 0x00], // 'B'
  [0x3C, 0x42, 0x40, 0x40, 0x40, 0x42, 0x3C, 0x00], // 'C'
];

let foundFontInRom = false;
for (let i = 0; i < rom.length - 8; i++) {
  for (const pattern of fontPatterns) {
    let matches = true;
    for (let j = 0; j < 8; j++) {
      if (rom[i + j] !== pattern[j]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      console.log(`  Found font pattern at ROM offset 0x${i.toString(16)}`);
      foundFontInRom = true;
      break;
    }
  }
  if (foundFontInRom) break;
}

if (!foundFontInRom) {
  console.log('  No standard ASCII font patterns found in ROM');
  console.log('  The test ROM likely expects font to be pre-loaded or uses custom graphics');
}
