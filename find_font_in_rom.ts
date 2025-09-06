import * as fs from 'fs';
import { normaliseRom } from './src/cart/loader.js';

const ROM_PATH = './test-roms/snes-tests/cputest/cputest-full.sfc';

// Load ROM
const raw = fs.readFileSync(ROM_PATH);
const { rom } = normaliseRom(new Uint8Array(raw));

console.log(`ROM size: ${rom.length} bytes (0x${rom.length.toString(16)})`);

// Search for sequences that look like font data
// Font tiles are typically 8x8 pixels, 2bpp = 16 bytes per tile
// We're looking for patterns that could be ASCII characters

// Look for sequences of non-zero bytes that could be font data
let candidates: number[] = [];
const minRun = 16 * 16; // At least 16 characters worth of data
const maxRun = 16 * 128; // Up to 128 characters

for (let i = 0; i < rom.length - minRun; i++) {
  // Check if this could be the start of font data
  let nonZeroCount = 0;
  let zeroCount = 0;
  let hasPattern = false;
  
  // Sample 256 bytes
  for (let j = 0; j < Math.min(256, rom.length - i); j++) {
    if (rom[i + j] !== 0) nonZeroCount++;
    else zeroCount++;
  }
  
  // Font data typically has a mix of zeros and non-zeros
  // Not all zeros, not all 0xFF
  if (nonZeroCount > 64 && nonZeroCount < 240 && zeroCount > 16) {
    // Check for repeating 16-byte patterns (2bpp tiles)
    let looks_like_tiles = true;
    for (let t = 0; t < 4; t++) {
      const tile_start = i + t * 16;
      if (tile_start + 16 > rom.length) break;
      
      // Check if this 16-byte block has reasonable tile structure
      // Should have some variation but not be random
      let tile_zeros = 0;
      for (let b = 0; b < 16; b++) {
        if (rom[tile_start + b] === 0) tile_zeros++;
      }
      
      // Tiles should have some empty rows but not all
      if (tile_zeros === 0 || tile_zeros === 16) {
        looks_like_tiles = false;
        break;
      }
    }
    
    if (looks_like_tiles) {
      candidates.push(i);
      i += 256; // Skip ahead to avoid duplicates
    }
  }
}

console.log(`\nFound ${candidates.length} potential font data regions`);

// Examine the most promising candidates
for (let idx = 0; idx < Math.min(10, candidates.length); idx++) {
  const offset = candidates[idx];
  console.log(`\nCandidate at offset 0x${offset.toString(16)}:`);
  
  // Show first few "tiles"
  for (let tile = 0; tile < 4; tile++) {
    const tileOffset = offset + tile * 16;
    if (tileOffset + 16 > rom.length) break;
    
    console.log(`  Tile ${tile}:`);
    // Show as 2bpp tile (8 rows of 2 bytes each)
    for (let row = 0; row < 8; row++) {
      const bp0 = rom[tileOffset + row * 2];
      const bp1 = rom[tileOffset + row * 2 + 1];
      
      let pixels = '';
      for (let px = 7; px >= 0; px--) {
        const p0 = (bp0 >> px) & 1;
        const p1 = (bp1 >> px) & 1;
        const pixel = (p1 << 1) | p0;
        pixels += pixel === 0 ? '.' : pixel.toString();
      }
      console.log(`    ${pixels} [${bp0.toString(16).padStart(2,'0')} ${bp1.toString(16).padStart(2,'0')}]`);
    }
  }
}

// Also look for specific ASCII patterns
// Try looking for 'A' (0x41) in 1bpp format (simpler)
console.log('\nSearching for specific character patterns (1bpp):');
// 'A' in 1bpp might look like:
const charA_1bpp = [
  0x18, // ...11...
  0x24, // ..1..1..
  0x42, // .1....1.
  0x7E, // .111111.
  0x42, // .1....1.
  0x42, // .1....1.
  0x42, // .1....1.
  0x00  // ........
];

for (let i = 0; i < rom.length - 8; i++) {
  let matches = true;
  for (let j = 0; j < 8; j++) {
    if (Math.abs(rom[i + j] - charA_1bpp[j]) > 2) { // Allow small variations
      matches = false;
      break;
    }
  }
  if (matches) {
    console.log(`  Found 'A'-like pattern at 0x${i.toString(16)}`);
  }
}

// Search for text strings that might indicate font location
console.log('\nSearching for text strings in ROM:');
const textToFind = ['FONT', 'CHAR', 'ASCII', 'TEST', 'CPU'];
for (const text of textToFind) {
  for (let i = 0; i < rom.length - text.length; i++) {
    let matches = true;
    for (let j = 0; j < text.length; j++) {
      if (rom[i + j] !== text.charCodeAt(j)) {
        matches = false;
        break;
      }
    }
    if (matches) {
      console.log(`  Found "${text}" at 0x${i.toString(16)}`);
      // Show surrounding context
      const start = Math.max(0, i - 16);
      const end = Math.min(rom.length, i + text.length + 16);
      const context = Array.from(rom.slice(start, end))
        .map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.')
        .join('');
      console.log(`    Context: ${context}`);
    }
  }
}

// Check if there's compressed data
console.log('\nChecking for compressed data markers:');
// Look for LZ77/RLE headers or patterns
for (let i = 0; i < Math.min(256, rom.length); i += 16) {
  const slice = Array.from(rom.slice(i, i + 16));
  const hex = slice.map(b => b.toString(16).padStart(2, '0')).join(' ');
  if (slice.some(b => b !== 0)) {
    console.log(`  0x${i.toString(16).padStart(4, '0')}: ${hex}`);
  }
}
