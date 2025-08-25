import { PPU } from './ppu';

function readByteFromVRAM(ppu: PPU, baseWordAddr: number, byteOffset: number): number {
  const wordAddr = baseWordAddr + (byteOffset >> 1);
  const w = ppu.inspectVRAMWord(wordAddr);
  if ((byteOffset & 1) === 0) return w & 0xff;
  return (w >>> 8) & 0xff;
}

// Decode a single 4bpp tile at (baseWordAddr + tileIndex*16 words) into an array of 64 palette indices.
export function render4bppTileIndices(ppu: PPU, baseWordAddr: number, tileIndex: number): number[] {
  const out: number[] = new Array(64);
  const tileWordBase = baseWordAddr + tileIndex * 16; // 32 bytes = 16 words

  for (let y = 0; y < 8; y++) {
    const row = y;
    const low0 = readByteFromVRAM(ppu, tileWordBase, row * 2 + 0); // plane 0
    const low1 = readByteFromVRAM(ppu, tileWordBase, row * 2 + 1); // plane 1
    const hi0 = readByteFromVRAM(ppu, tileWordBase, 16 + row * 2 + 0); // plane 2
    const hi1 = readByteFromVRAM(ppu, tileWordBase, 16 + row * 2 + 1); // plane 3

    for (let x = 0; x < 8; x++) {
      const bit = 7 - x;
      const p0 = (low0 >> bit) & 1;
      const p1 = (low1 >> bit) & 1;
      const p2 = (hi0 >> bit) & 1;
      const p3 = (hi1 >> bit) & 1;
      const idx = (p3 << 3) | (p2 << 2) | (p1 << 1) | p0;
      out[y * 8 + x] = idx;
    }
  }

  return out;
}
