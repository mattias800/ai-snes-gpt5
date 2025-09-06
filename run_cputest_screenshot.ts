import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { normaliseRom } from './src/cart/loader.js';
import { parseHeader } from './src/cart/header.js';
import { Cartridge } from './src/cart/cartridge.js';
import { Emulator } from './src/emulator/core.js';
import { Scheduler } from './src/emulator/scheduler.js';
import { renderMainScreenRGBA } from './src/ppu/bg.js';

const ROM_PATH = './test-roms/snes-tests/cputest/cputest-full.sfc';

// Load ROM
const raw = fs.readFileSync(ROM_PATH);
const { rom } = normaliseRom(new Uint8Array(raw));
const header = parseHeader(rom);
const cart = new Cartridge({ rom, mapping: header.mapping });

// Create emulator
const emu = Emulator.fromCartridge(cart);
emu.reset();

// Create scheduler
const sched = new Scheduler(emu, 1000, { onCpuError: 'throw' });
const ppu = emu.bus.getPPU() as any;

// Run for more frames to let the ROM initialize and display test results
const FRAMES = 1800; // 30 seconds at 60fps - give tests more time to complete
console.log(`Running cputest-full.sfc for ${FRAMES} frames (${FRAMES/60} seconds)...`);

// Track BG1 char base changes
let lastCharBase = ppu.bg1CharBaseWord;

for (let frame = 0; frame < FRAMES; frame++) {
  sched.stepFrame();
  
  // Check if BG1 char base changed
  if (ppu.bg1CharBaseWord !== lastCharBase) {
    console.log(`  Frame ${frame}: BG1 char base changed from 0x${lastCharBase.toString(16)} to 0x${ppu.bg1CharBaseWord.toString(16)}`);
    lastCharBase = ppu.bg1CharBaseWord;
  }
  
  if (frame % 60 === 0) {
    console.log(`Frame ${frame}/${FRAMES} (${frame/60} seconds)`);
    
    // Check VRAM periodically to see when data appears
    if (frame === 120 || frame === 240 || frame === 360) {
      let nonZero = 0;
      if ((ppu as any).vram) {
        const vram = (ppu as any).vram as Uint16Array;
        for (let i = 0; i < Math.min(0x8000, vram.length); i++) {
          if (vram[i] !== 0) nonZero++;
        }
      }
      console.log(`  VRAM non-zero words at frame ${frame}: ${nonZero}`);
    }
  }
}

console.log('Checking PPU state before rendering...');
console.log(`PPU forceBlank: ${ppu.forceBlank}`);
console.log(`PPU brightness: ${ppu.brightness}`);
console.log(`PPU TM (main screen enable): 0x${ppu.tm.toString(16).padStart(2, '0')}`);
console.log(`PPU bgMode: ${ppu.bgMode}`);
console.log(`BG1 enabled: ${(ppu.tm & 0x01) !== 0}`);
console.log(`BG1 map base word: 0x${ppu.bg1MapBaseWord.toString(16)}`);
console.log(`BG1 char base word: 0x${ppu.bg1CharBaseWord.toString(16)}`);
console.log(`BG1 HOfs: ${ppu.bg1HOfs}`);
console.log(`BG1 VOfs: ${ppu.bg1VOfs}`);
console.log(`BG1 tile size 16: ${ppu.bg1TileSize16}`);

// Calculate what tilemap rows would be visible with VOfs = 2047
const vofs = ppu.bg1VOfs;
const firstVisibleRow = Math.floor(vofs / 8) % 32;
const lastVisibleRow = Math.floor((vofs + 223) / 8) % 32;
console.log(`With VOfs=${vofs}, visible tilemap rows would be: ${firstVisibleRow} to ${lastVisibleRow}`);

// Check if screen is blanked or disabled
if (ppu.forceBlank) {
  console.log('WARNING: Screen is in forced blank mode!');
}
if (ppu.brightness === 0) {
  console.log('WARNING: Screen brightness is 0!');
}
if (ppu.tm === 0) {
  console.log('WARNING: No layers enabled on main screen!');
}

// Let's manually check what BG1 should look like
console.log('\nManually checking BG1 rendering...');
const vram = (ppu as any).vram as Uint16Array;
const cgram = (ppu as any).cgram as Uint8Array;

// Check a specific pixel position that should have text
// Row 1 of tilemap has text, so pixel row 8-15 should have characters
const testY = 10; // Pixel in the middle of row 1
const testX = 16; // Start of second tile

// Calculate what tile this pixel should be showing with VOfs=2047
const worldY = (testY + ppu.bg1VOfs) >>> 0;
const worldX = (testX + ppu.bg1HOfs) >>> 0;
const tileY = Math.floor(worldY / 8) % 32;
const tileX = Math.floor(worldX / 8) % 32;
const inTileY = worldY % 8;
const inTileX = worldX % 8;

const tilemapAddr = ppu.bg1MapBaseWord + tileY * 32 + tileX;
const tilemapEntry = vram[tilemapAddr];
const tileIndex = tilemapEntry & 0x3FF;
const paletteGroup = (tilemapEntry >> 10) & 0x7;

console.log(`Test pixel (${testX},${testY}):`);
console.log(`  World coords: (${worldX},${worldY})`);
console.log(`  Tile coords: (${tileX},${tileY})`);
console.log(`  In-tile coords: (${inTileX},${inTileY})`);
console.log(`  Tilemap address: 0x${tilemapAddr.toString(16)}, entry: 0x${tilemapEntry.toString(16)}`);
console.log(`  Tile index: ${tileIndex}, palette: ${paletteGroup}`);

// Check what this tile looks like
if (tileIndex > 0) {
  console.log(`\nTile ${tileIndex} (0x${tileIndex.toString(16)}) data at configured base 0x${ppu.bg1CharBaseWord.toString(16)}:`);
  const charBase = ppu.bg1CharBaseWord;
  
  // In mode 0, BG1 is 2bpp = 8 words per tile
  console.log('  2bpp data (8 words):');
  for (let row = 0; row < 8; row++) {
    const wordAddr = charBase + tileIndex * 8 + row;
    const word = vram[wordAddr];
    const bp0 = word & 0xFF;
    const bp1 = (word >> 8) & 0xFF;
    
    let pixels = '  ';
    for (let px = 0; px < 8; px++) {
      const bit = 7 - px;
      const p0 = (bp0 >> bit) & 1;
      const p1 = (bp1 >> bit) & 1;
      const pixel = (p1 << 1) | p0;
      pixels += pixel.toString();
    }
    console.log(`    Row ${row}: word=0x${word.toString(16).padStart(4, '0')} -> ${pixels}`);
  }
  
  // Also check at base 0x0 where the data actually is
  console.log(`\nTile ${tileIndex} (0x${tileIndex.toString(16)}) data at base 0x0 (where font actually is):`);
  console.log('  2bpp data (8 words):');
  for (let row = 0; row < 8; row++) {
    const wordAddr = 0 + tileIndex * 8 + row;
    const word = vram[wordAddr];
    const bp0 = word & 0xFF;
    const bp1 = (word >> 8) & 0xFF;
    
    let pixels = '  ';
    for (let px = 0; px < 8; px++) {
      const bit = 7 - px;
      const p0 = (bp0 >> bit) & 1;
      const p1 = (bp1 >> bit) & 1;
      const pixel = (p1 << 1) | p0;
      pixels += pixel.toString();
    }
    console.log(`    Row ${row}: word=0x${word.toString(16).padStart(4, '0')} -> ${pixels}`);
  }
}

console.log('Rendering frame to PNG...');

// Get the frame buffer dimensions
const width = 256;
const height = 224;

// Use the PPU rendering function to get RGBA data
const rgba = renderMainScreenRGBA(ppu, width, height);

// Analyze pixel data
console.log('Analyzing pixel data...');
let allBlack = true;
let allWhite = true;
let uniqueColors = new Set<number>();

for (let i = 0; i < rgba.length; i += 4) {
  const r = rgba[i];
  const g = rgba[i + 1];
  const b = rgba[i + 2];
  const a = rgba[i + 3];
  
  const colorCode = (r << 24) | (g << 16) | (b << 8) | a;
  uniqueColors.add(colorCode);
  
  if (r !== 0 || g !== 0 || b !== 0) allBlack = false;
  if (r !== 255 || g !== 255 || b !== 255) allWhite = false;
}

console.log(`All pixels black: ${allBlack}`);
console.log(`All pixels white: ${allWhite}`);
console.log(`Unique colors: ${uniqueColors.size}`);

if (uniqueColors.size <= 10) {
  console.log('Color values:');
  uniqueColors.forEach(color => {
    const r = (color >> 24) & 0xFF;
    const g = (color >> 16) & 0xFF;
    const b = (color >> 8) & 0xFF;
    const a = color & 0xFF;
    console.log(`  R=${r}, G=${g}, B=${b}, A=${a}`);
  });
}

// Sample first few pixels
console.log('First 10 pixels (RGBA):');
for (let i = 0; i < Math.min(40, rgba.length); i += 4) {
  const pixelNum = i / 4;
  console.log(`  Pixel ${pixelNum}: R=${rgba[i]}, G=${rgba[i+1]}, B=${rgba[i+2]}, A=${rgba[i+3]}`);
}

// Create PNG from the RGBA data
const png = new PNG({ width, height });

// Copy RGBA data to PNG buffer
for (let i = 0; i < rgba.length; i++) {
  png.data[i] = rgba[i];
}

// Save PNG
const outputPath = 'cputest-full-10sec.png';
const buffer = PNG.sync.write(png);
fs.writeFileSync(outputPath, buffer);

console.log(`Screenshot saved to ${outputPath}`);

// Also print some debug info
console.log('\nEmulator state:');
console.log(`PPU scanline: ${ppu.scanline}`);
console.log(`PPU frame: ${ppu.frame || 0}`);
console.log(`INIDISP: 0x${(ppu.inidisp || 0).toString(16).padStart(2, '0')}`);
console.log(`Screen on: ${(ppu.inidisp & 0x80) === 0}`);

// Check VRAM for any tile data
let nonZeroCount = 0;
if ((ppu as any).vram) {
  const vram = (ppu as any).vram as Uint16Array;
  for (let i = 0; i < Math.min(0x8000, vram.length); i++) {
    if (vram[i] !== 0) {
      nonZeroCount++;
    }
  }
}
console.log(`VRAM non-zero words: ${nonZeroCount} / ${0x8000}`);

// Check first few CGRAM entries
if ((ppu as any).cgram) {
  const cgram = (ppu as any).cgram as Uint8Array;
  console.log('First 16 CGRAM colors (BGR555):');
  for (let i = 0; i < 16; i++) {
    const lo = cgram[i * 2] || 0;
    const hi = cgram[i * 2 + 1] || 0;
    const color = lo | (hi << 8);
    const r = (color >> 10) & 0x1F;
    const g = (color >> 5) & 0x1F;
    const b = color & 0x1F;
    console.log(`  Color ${i}: 0x${color.toString(16).padStart(4, '0')} (R=${r},G=${g},B=${b})`);
  }
}

// Check if there's any text tile data in VRAM (non-zero patterns)
console.log('\nChecking for text tiles in VRAM...');
if ((ppu as any).vram) {
  const vram = (ppu as any).vram as Uint16Array;
  
  // Check character data area (usually starts at 0x0000 or 0x1000)
  let hasTextTiles = false;
  for (let addr = 0; addr < 0x2000; addr++) {
    const word = vram[addr];
    // Look for typical text patterns (not all zeros, not all ones)
    if (word !== 0 && word !== 0xFFFF) {
      hasTextTiles = true;
      break;
    }
  }
  console.log(`Has text tile patterns: ${hasTextTiles}`);
  
  // Sample some tilemap entries at BG1 map base
  console.log('Sample BG1 tilemap entries at map base:');
  const bg1MapBase = ppu.bg1MapBaseWord;
  for (let y = 0; y < 4; y++) {
    let line = '';
    for (let x = 0; x < 8; x++) {
      const addr = bg1MapBase + y * 32 + x;
      const entry = vram[addr];
      const tileNum = entry & 0x3FF;
      if (entry !== 0) {
        line += ` ${tileNum.toString(16).padStart(3, '0')}`;
      } else {
        line += ' ---';
      }
    }
    console.log(`  Row ${y}: ${line}`);
  }
  
  // Search for tile data throughout VRAM
  console.log('\nSearching for tile data in VRAM...');
  
  // Check what tiles have data at base 0x0
  console.log('  Checking which tiles have data at base 0x0...');
  const nonEmptyTiles: number[] = [];
  for (let tile = 0; tile < 256; tile++) {
    const addr = tile * 8; // 2bpp = 8 words per tile
    let hasData = false;
    for (let w = 0; w < 8 && addr + w < 0x8000; w++) {
      if (vram[addr + w] !== 0) {
        hasData = true;
        break;
      }
    }
    if (hasData) {
      nonEmptyTiles.push(tile);
    }
  }
  console.log(`  Non-empty tiles at base 0x0: ${nonEmptyTiles.slice(0, 20).map(t => '0x' + t.toString(16)).join(', ')}${nonEmptyTiles.length > 20 ? '...' : ''}`);
  console.log(`  Total non-empty tiles: ${nonEmptyTiles.length}`);
  
  // Check a few specific tiles that are in the tilemap
  const tilesToCheck = [0x52, 0x75, 0x6e, 0x69, 0x67, 0x54, 0x65, 0x73, 0x74, 0x20]; // "Running Test "
  console.log('\n  Checking specific tiles from tilemap:');
  for (const tileIdx of tilesToCheck) {
    const addr = tileIdx * 8;
    let hasData = false;
    for (let w = 0; w < 8; w++) {
      if (vram[addr + w] !== 0) {
        hasData = true;
        break;
      }
    }
    console.log(`    Tile 0x${tileIdx.toString(16)} (chr '${String.fromCharCode(tileIdx)}'): ${hasData ? 'HAS DATA' : 'empty'}`);
  }
  
  // Check what tile data looks like at the configured char base
  console.log('\nSample tile data at char base 0x2000:');
  const charBase = ppu.bg1CharBaseWord;
  for (let tileIdx = 0; tileIdx < 256; tileIdx++) {
    let hasData = false;
    // Check if this tile has any non-zero data (2bpp in mode 0 = 8 words per tile)
    for (let w = 0; w < 8; w++) {
      if (vram[charBase + tileIdx * 8 + w] !== 0) {
        hasData = true;
        break;
      }
    }
    if (hasData) {
      console.log(`  Found non-zero tile at index ${tileIdx} (0x${tileIdx.toString(16)}):`);
      for (let row = 0; row < 8; row++) {
        const bp0 = vram[charBase + tileIdx * 16 + row] & 0xFF;
        const bp1 = (vram[charBase + tileIdx * 16 + row] >> 8) & 0xFF;
        const bp2 = vram[charBase + tileIdx * 16 + row + 8] & 0xFF;
        const bp3 = (vram[charBase + tileIdx * 16 + row + 8] >> 8) & 0xFF;
        
        let line = '  ';
        for (let px = 0; px < 8; px++) {
          const bit = 7 - px;
          const p0 = (bp0 >> bit) & 1;
          const p1 = (bp1 >> bit) & 1;
          const p2 = (bp2 >> bit) & 1;
          const p3 = (bp3 >> bit) & 1;
          const pixel = p0 | (p1 << 1) | (p2 << 2) | (p3 << 3);
          line += pixel.toString(16);
        }
        console.log(`    Row ${row}: ${line}`);
      }
      break;
    }
  }
}
