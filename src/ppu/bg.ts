import { PPU } from './ppu';
import { render4bppTileIndices } from './renderer';

// Render a 4bpp BG tilemap region into palette indices.
// - mapBaseWordAddr: VRAM word address of the tilemap base (assumed 32x32 entries)
// - tileBaseWordAddr: VRAM word address where tile graphics begin
// - widthTiles, heightTiles: dimensions in tiles of the region to render (<= 32x32)
export function renderBG4bppTilemapIndices(
  ppu: PPU,
  mapBaseWordAddr: number,
  tileBaseWordAddr: number,
  widthTiles: number,
  heightTiles: number
): number[] {
  const W = widthTiles * 8;
  const H = heightTiles * 8;
  const out = new Array(W * H).fill(0);

  for (let ty = 0; ty < heightTiles; ty++) {
    for (let tx = 0; tx < widthTiles; tx++) {
      const entry = ppu.inspectVRAMWord(mapBaseWordAddr + ty * 32 + tx);
      const tileIndex = entry & 0x03ff;
      const paletteGroup = (entry >>> 10) & 0x07; // 0..7 -> adds 16*group
      const xFlip = (entry & 0x4000) !== 0;
      const yFlip = (entry & 0x8000) !== 0;

      const tile = render4bppTileIndices(ppu, tileBaseWordAddr, tileIndex);

      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          const sx = xFlip ? (7 - px) : px;
          const sy = yFlip ? (7 - py) : py;
          const pix = tile[sy * 8 + sx];
          const palIndex = paletteGroup * 16 + pix;
          out[(ty * 8 + py) * W + (tx * 8 + px)] = palIndex;
        }
      }
    }
  }

  return out;
}

// Render a BG1 region (in pixels) using PPU's BG1 registers (map base, char base, scroll).
export function renderBG1RegionIndices(ppu: PPU, widthPixels: number, heightPixels: number): number[] {
  const out = new Array(widthPixels * heightPixels).fill(0);
  const mapBase = ppu.bg1MapBaseWord;
  const charBase = ppu.bg1CharBaseWord;

  for (let y = 0; y < heightPixels; y++) {
    for (let x = 0; x < widthPixels; x++) {
      const worldX = (x + ppu.bg1HOfs) >>> 0;
      const worldY = (y + ppu.bg1VOfs) >>> 0;
      const tileX = Math.floor(worldX / 8) & 31; // 32x32 map assumed
      const tileY = Math.floor(worldY / 8) & 31;
      const inTileX = worldX & 7;
      const inTileY = worldY & 7;

      const entry = ppu.inspectVRAMWord(mapBase + tileY * 32 + tileX);
      const tileIndex = entry & 0x03ff;
      const paletteGroup = (entry >>> 10) & 0x07;
      const xFlip = (entry & 0x4000) !== 0;
      const yFlip = (entry & 0x8000) !== 0;

      const tile = render4bppTileIndices(ppu, charBase, tileIndex);
      const sx = xFlip ? (7 - inTileX) : inTileX;
      const sy = yFlip ? (7 - inTileY) : inTileY;
      const pix = tile[sy * 8 + sx];
      out[y * widthPixels + x] = paletteGroup * 16 + pix;
    }
  }

  return out;
}
