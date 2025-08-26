import { PPU } from './ppu';
import { render4bppTileIndices, render2bppTileIndices } from './renderer';
import { decodeSNESColorToRGBA } from './palette';

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

// Render a BG2 region (in pixels) using PPU's BG2 registers
export function renderBG2RegionIndices(ppu: PPU, widthPixels: number, heightPixels: number): number[] {
  const out = new Array(widthPixels * heightPixels).fill(0);
  const mapBase = ppu.bg2MapBaseWord;
  const charBase = ppu.bg2CharBaseWord;

  const tileSize = (ppu as any).bg2TileSize16 ? 16 : 8;
  const mapWidth = ppu.bg2MapWidth64 ? 64 : 32;
  const mapHeight = ppu.bg2MapHeight64 ? 64 : 32;

  for (let y = 0; y < heightPixels; y++) {
    for (let x = 0; x < widthPixels; x++) {
      const worldX = (x + ppu.bg2HOfs) >>> 0;
      const worldY = (y + ppu.bg2VOfs) >>> 0;

      let tileX = Math.floor(worldX / tileSize) % mapWidth;
      let tileY = Math.floor(worldY / tileSize) % mapHeight;
      if (tileX < 0) tileX += mapWidth;
      if (tileY < 0) tileY += mapHeight;

      let inTileX = worldX % tileSize; if (inTileX < 0) inTileX += tileSize;
      let inTileY = worldY % tileSize; if (inTileY < 0) inTileY += tileSize;

      // Handle 64x32/32x64/64x64 screen arrangements for BG2 similar to BG1
      let screenOffset = 0; // in words
      if (ppu.bg2MapWidth64 && tileX >= 32) { tileX -= 32; screenOffset += 0x400; }
      if (ppu.bg2MapHeight64 && tileY >= 32) { tileY -= 32; screenOffset += 0x800; }

      const entry = ppu.inspectVRAMWord(mapBase + screenOffset + tileY * 32 + tileX);
      const tileIndexBase = entry & 0x03ff;
      const paletteGroup = (entry >>> 10) & 0x07;
      const xFlip = (entry & 0x4000) !== 0;
      const yFlip = (entry & 0x8000) !== 0;

      if (!(ppu as any).bg2TileSize16) {
        const sx = xFlip ? (7 - (inTileX & 7)) : (inTileX & 7);
        const sy = yFlip ? (7 - (inTileY & 7)) : (inTileY & 7);
        const tile = render4bppTileIndices(ppu, charBase, tileIndexBase);
        const pix = tile[sy * 8 + sx];
        out[y * widthPixels + x] = paletteGroup * 16 + pix;
      } else {
        // 16x16 composed of four 8x8 tiles: right +1, down +16
        const effX = xFlip ? ((tileSize - 1) - inTileX) : inTileX;
        const effY = yFlip ? ((tileSize - 1) - inTileY) : inTileY;
        const subX = (effX >> 3) & 1;
        const subY = (effY >> 3) & 1;
        const inSubX = effX & 7;
        const inSubY = effY & 7;
        const subTileIndex = tileIndexBase + subX + (subY << 4);
        const tile = render4bppTileIndices(ppu, charBase, subTileIndex);
        const pix = tile[inSubY * 8 + inSubX];
        out[y * widthPixels + x] = paletteGroup * 16 + pix;
      }
    }
  }

  return out;
}

// Render BG1 to an RGBA Uint8ClampedArray using CGRAM palette colors.
export function renderBG1RegionRGBA(ppu: PPU, widthPixels: number, heightPixels: number): Uint8ClampedArray {
  const indices = renderBG1RegionIndices(ppu, widthPixels, heightPixels);
  const out = new Uint8ClampedArray(widthPixels * heightPixels * 4);
  // Brightness scale 0..15; 0=black, 15=full. Forced blank -> black.
  const scale = ppu.forceBlank ? 0 : Math.max(0, Math.min(15, ppu.brightness)) / 15;
  const enableBG1 = (ppu.tm & 0x01) !== 0;
  for (let i = 0; i < indices.length; i++) {
    const palIdx = indices[i] & 0xff; // 0..127 typical for 4bpp BG1 with palette groups
    const color = enableBG1 ? ppu.inspectCGRAMWord(palIdx) : 0;
    const { r, g, b, a } = decodeSNESColorToRGBA(color);
    const o = i * 4;
    out[o] = Math.round(r * scale);
    out[o + 1] = Math.round(g * scale);
    out[o + 2] = Math.round(b * scale);
    out[o + 3] = a;
  }
  return out;
}

// Render BG2 to an RGBA Uint8ClampedArray using CGRAM palette colors.
export function renderBG2RegionRGBA(ppu: PPU, widthPixels: number, heightPixels: number): Uint8ClampedArray {
  const indices = renderBG2RegionIndices(ppu, widthPixels, heightPixels);
  const out = new Uint8ClampedArray(widthPixels * heightPixels * 4);
  const scale = ppu.forceBlank ? 0 : Math.max(0, Math.min(15, ppu.brightness)) / 15;
  const enableBG2 = (ppu.tm & 0x02) !== 0;
  for (let i = 0; i < indices.length; i++) {
    const palIdx = indices[i] & 0xff;
    const color = enableBG2 ? ppu.inspectCGRAMWord(palIdx) : 0;
    const { r, g, b, a } = decodeSNESColorToRGBA(color);
    const o = i * 4;
    out[o] = Math.round(r * scale);
    out[o + 1] = Math.round(g * scale);
    out[o + 2] = Math.round(b * scale);
    out[o + 3] = a;
  }
  return out;
}

// Compose main screen BG1 over BG2 (very simplified). Pixel value 0 is treated as transparent.
// Compute per-pixel priority masks (1 = high priority, 0 = low) for BG1
function computeBG1PriorityMask(ppu: PPU, widthPixels: number, heightPixels: number): number[] {
  const out = new Array(widthPixels * heightPixels).fill(0);
  const mapBase = ppu.bg1MapBaseWord;
  const tileSize = ppu.bg1TileSize16 ? 16 : 8;
  const mapWidth = ppu.bg1MapWidth64 ? 64 : 32;
  const mapHeight = ppu.bg1MapHeight64 ? 64 : 32;
  for (let y = 0; y < heightPixels; y++) {
    for (let x = 0; x < widthPixels; x++) {
      const worldX = (x + ppu.bg1HOfs) >>> 0;
      const worldY = (y + ppu.bg1VOfs) >>> 0;
      let tileX = Math.floor(worldX / tileSize) % mapWidth;
      let tileY = Math.floor(worldY / tileSize) % mapHeight;
      if (tileX < 0) tileX += mapWidth;
      if (tileY < 0) tileY += mapHeight;
      let screenOffset = 0;
      if (ppu.bg1MapWidth64 && tileX >= 32) { tileX -= 32; screenOffset += 0x400; }
      if (ppu.bg1MapHeight64 && tileY >= 32) { tileY -= 32; screenOffset += 0x800; }
      const entry = ppu.inspectVRAMWord(mapBase + screenOffset + tileY * 32 + tileX);
      out[y * widthPixels + x] = (entry & 0x2000) ? 1 : 0;
    }
  }
  return out;
}

// Compute per-pixel priority masks for BG2 (8x8 tiles, 32x32 map)
function computeBG2PriorityMask(ppu: PPU, widthPixels: number, heightPixels: number): number[] {
  const out = new Array(widthPixels * heightPixels).fill(0);
  const mapBase = ppu.bg2MapBaseWord;
  const tileSize = (ppu as any).bg2TileSize16 ? 16 : 8;
  const mapWidth = ppu.bg2MapWidth64 ? 64 : 32;
  const mapHeight = ppu.bg2MapHeight64 ? 64 : 32;
  for (let y = 0; y < heightPixels; y++) {
    for (let x = 0; x < widthPixels; x++) {
      const worldX = (x + ppu.bg2HOfs) >>> 0;
      const worldY = (y + ppu.bg2VOfs) >>> 0;
      let tileX = Math.floor(worldX / tileSize) % mapWidth;
      let tileY = Math.floor(worldY / tileSize) % mapHeight;
      if (tileX < 0) tileX += mapWidth;
      if (tileY < 0) tileY += mapHeight;
      let screenOffset = 0;
      if (ppu.bg2MapWidth64 && tileX >= 32) { tileX -= 32; screenOffset += 0x400; }
      if (ppu.bg2MapHeight64 && tileY >= 32) { tileY -= 32; screenOffset += 0x800; }
      const entry = ppu.inspectVRAMWord(mapBase + screenOffset + tileY * 32 + tileX);
      out[y * widthPixels + x] = (entry & 0x2000) ? 1 : 0;
    }
  }
  return out;
}

// Compute per-pixel priority masks for BG3 (8x8 tiles, 32x32 map)
function computeBG3PriorityMask(ppu: PPU, widthPixels: number, heightPixels: number): number[] {
  const out = new Array(widthPixels * heightPixels).fill(0);
  const mapBase = ppu.bg3MapBaseWord;
  const tileSize = 8;
  const mapWidth = 32;
  const mapHeight = 32;
  for (let y = 0; y < heightPixels; y++) {
    for (let x = 0; x < widthPixels; x++) {
      const worldX = (x + ppu.bg3HOfs) >>> 0;
      const worldY = (y + ppu.bg3VOfs) >>> 0;
      let tileX = Math.floor(worldX / tileSize) % mapWidth;
      let tileY = Math.floor(worldY / tileSize) % mapHeight;
      if (tileX < 0) tileX += mapWidth;
      if (tileY < 0) tileY += mapHeight;
      const entry = ppu.inspectVRAMWord(mapBase + tileY * 32 + tileX);
      out[y * widthPixels + x] = (entry & 0x2000) ? 1 : 0;
    }
  }
  return out;
}

// Render a BG3 region (2bpp) indices
export function renderBG3RegionIndices(ppu: PPU, widthPixels: number, heightPixels: number): number[] {
  const out = new Array(widthPixels * heightPixels).fill(0);
  const mapBase = ppu.bg3MapBaseWord;
  const charBase = ppu.bg3CharBaseWord;

  const tileSize = 8;
  const mapWidth = 32;
  const mapHeight = 32;

  for (let y = 0; y < heightPixels; y++) {
    for (let x = 0; x < widthPixels; x++) {
      const worldX = (x + ppu.bg3HOfs) >>> 0;
      const worldY = (y + ppu.bg3VOfs) >>> 0;

      let tileX = Math.floor(worldX / tileSize) % mapWidth;
      let tileY = Math.floor(worldY / tileSize) % mapHeight;
      if (tileX < 0) tileX += mapWidth;
      if (tileY < 0) tileY += mapHeight;

      let inTileX = worldX % tileSize; if (inTileX < 0) inTileX += tileSize;
      let inTileY = worldY % tileSize; if (inTileY < 0) inTileY += tileSize;

      const entry = ppu.inspectVRAMWord(mapBase + tileY * 32 + tileX);
      const tileIndexBase = entry & 0x03ff;
      const paletteGroup = (entry >>> 10) & 0x07;
      const xFlip = (entry & 0x4000) !== 0;
      const yFlip = (entry & 0x8000) !== 0;

      const sx = xFlip ? (7 - (inTileX & 7)) : (inTileX & 7);
      const sy = yFlip ? (7 - (inTileY & 7)) : (inTileY & 7);
      const tile = render2bppTileIndices(ppu, charBase, tileIndexBase);
      const pix = tile[sy * 8 + sx];
      out[y * widthPixels + x] = paletteGroup * 16 + pix;
    }
  }

  return out;
}

export function renderMainScreenRGBA(ppu: PPU, widthPixels: number, heightPixels: number): Uint8ClampedArray {
  const bg1 = renderBG1RegionIndices(ppu, widthPixels, heightPixels);
  const bg2 = renderBG2RegionIndices(ppu, widthPixels, heightPixels);
  const bg3 = renderBG3RegionIndices(ppu, widthPixels, heightPixels);
  const pr1 = computeBG1PriorityMask(ppu, widthPixels, heightPixels);
  const pr2 = computeBG2PriorityMask(ppu, widthPixels, heightPixels);
  const pr3 = computeBG3PriorityMask(ppu, widthPixels, heightPixels);
  const out = new Uint8ClampedArray(widthPixels * heightPixels * 4);
  const scale = ppu.forceBlank ? 0 : Math.max(0, Math.min(15, ppu.brightness)) / 15;
  const enableBG1 = (ppu.tm & 0x01) !== 0;
  const enableBG2 = (ppu.tm & 0x02) !== 0;
  const enableBG3 = (ppu.tm & 0x04) !== 0;
  const enableOBJ = (ppu.tm & 0x10) !== 0;
  const subBG1 = (ppu.ts & 0x01) !== 0;
  const subBG2 = (ppu.ts & 0x02) !== 0;
  const subBG3 = (ppu.ts & 0x04) !== 0;
  const subOBJ = (ppu.ts & 0x10) !== 0;
  const backColor = ppu.inspectCGRAMWord(0);

  // Simplified: global enable controlled by bit5 (legacy for our tests)
  const globalEnable = (ppu.cgadsub & 0x20) !== 0;
  const subtract = (ppu.cgadsub & 0x80) !== 0;
  const half = (ppu.cgadsub & 0x40) !== 0;
  const mask = ppu.cgadsub & 0x1f; // per-layer select (BG1..BG4/OBJ) + bit5 used as global in tests

  // Windowing: two inclusive ranges A[wh0..wh1] and B[wh2..wh3].
  // W12SEL/W34SEL/WOBJSEL enable gating per layer but we only support A/B with OR/AND/XOR/XNOR via CGWSEL bits 6-7.
  // cgwsel bit0: 0 = apply outside combined window, 1 = inside combined window
  const aL = (ppu.wh0 & 0xff) >>> 0;
  const aR = (ppu.wh1 & 0xff) >>> 0;
  const bL = (ppu.wh2 & 0xff) >>> 0;
  const bR = (ppu.wh3 & 0xff) >>> 0;
  function inRangeWrap(x: number, L: number, R: number): boolean {
    if (L <= R) return x >= L && x <= R;
    // wrap-around case: inside if x >= L OR x <= R
    return x >= L || x <= R;
  }
  function inA(x: number): boolean { return inRangeWrap(x, aL, aR); }
  function inB(x: number): boolean { return inRangeWrap(x, bL, bR); }
  const comb = (ppu.cgwsel >> 6) & 0x03; // 00=OR,01=AND,10=XOR,11=XNOR
  function combineWin(ax: boolean, bx: boolean): boolean {
    switch (comb) {
      case 0: return ax || bx;
      case 1: return ax && bx;
      case 2: return ax !== bx;
      case 3: return !(ax !== bx);
      default: return ax || bx;
    }
  }
  const applyInside = (ppu.cgwsel & 0x01) !== 0;

  // Minimal OBJ sampler: iterate OAM entries (128 max), 8x8 or 16x16 4bpp, H/V flips via attr; bit0 used as high X (adds 256).
  function sampleOBJPixel(x: number, y: number): { pal: number; zero: boolean; pri: number } {
    let best = { pal: 0, zero: true, pri: -1, idx: 9999 } as { pal: number; zero: boolean; pri: number; idx: number };
    const size = ppu.objSize16 ? 16 : 8;
    for (let i = 0; i < 128; i++) {
      const base = i * 4;
      const oy = ppu.inspectOAMByte(base) | 0;
      const oxLow = ppu.inspectOAMByte(base + 1) | 0;
      const tile = ppu.inspectOAMByte(base + 2) | 0;
      const attr = ppu.inspectOAMByte(base + 3) | 0;
      // High table: one byte per sprite (simplified) at oam[512 + i]
      const high = ppu.inspectOAMByte(512 + i) | 0;
      const ox = oxLow + ((high & 0x01) ? 256 : 0);
      // Per-sprite size override: high bit1 -> 16x16, else use global
      const sprSize = (high & 0x02) ? 16 : (ppu.objSize16 ? 16 : 8);
      const lx = x - ox;
      const ly = y - oy;
      if (lx < 0 || ly < 0 || lx >= sprSize || ly >= sprSize) continue;
      const hflip = (attr & 0x40) !== 0;
      const vflip = (attr & 0x80) !== 0;
      const effX = hflip ? (sprSize - 1 - (lx & (sprSize - 1))) : (lx & (sprSize - 1));
      const effY = vflip ? (sprSize - 1 - (ly & (sprSize - 1))) : (ly & (sprSize - 1));

      let pix = 0;
      if (sprSize === 8) {
        const tx = effX & 7;
        const ty = effY & 7;
        const tileData = render4bppTileIndices(ppu, ppu.objCharBaseWord, tile);
        pix = tileData[ty * 8 + tx];
      } else {
        // 16x16 composed of four 8x8 tiles: right +1, down +16
        const subX = (effX >> 3) & 1;
        const subY = (effY >> 3) & 1;
        const inSubX = effX & 7;
        const inSubY = effY & 7;
        const subTileIndex = tile + subX + (subY << 4);
        const tileData = render4bppTileIndices(ppu, ppu.objCharBaseWord, subTileIndex);
        pix = tileData[inSubY * 8 + inSubX];
      }

      const zero = (pix & 0x0f) === 0;
      if (zero) continue;
      const palIndex = ((attr >> 1) & 0x07) * 16 + pix; // palette group from attr bits 1-3
      const pri = (attr & 0x20) ? 1 : 0; // simple priority from attr bit5
      if (pri > best.pri || (pri === best.pri && i < best.idx)) {
        best = { pal: palIndex, zero: false, pri, idx: i };
      }
    }
    if (best.pri < 0) return { pal: 0, zero: true, pri: 0 };
    return { pal: best.pal, zero: false, pri: best.pri };
  }

  for (let i = 0; i < bg1.length; i++) {
    const pal1 = bg1[i] & 0xff; const z1 = (pal1 & 0x0f) === 0; const prio1 = pr1[i] | 0;
    const pal2 = bg2[i] & 0xff; const z2 = (pal2 & 0x0f) === 0; const prio2 = pr2[i] | 0;
    const pal3 = bg3[i] & 0xff; const z3 = (pal3 & 0x0f) === 0; const prio3 = pr3[i] | 0;

    // Choose main pixel by priority among enabled TM layers
    let mainColor: number = backColor;
    let mainLayer = 0; // 0=backdrop, 1=BG1, 2=BG2, 3=BG3, 4=OBJ
    let bestPri = -1;
    function considerMain(layerId: number, layerEnabled: boolean, zero: boolean, pri: number, pal: number) {
      if (!layerEnabled || zero) return;
      if (pri > bestPri) { bestPri = pri; mainColor = ppu.inspectCGRAMWord(pal); mainLayer = layerId; }
    }
    const x = i % widthPixels; const y = Math.floor(i / widthPixels);
    const obj = sampleOBJPixel(x, y);
    considerMain(1, enableBG1, z1, prio1, pal1);
    considerMain(2, enableBG2, z2, prio2, pal2);
    considerMain(3, enableBG3, z3, prio3, pal3);
    considerMain(4, enableOBJ, obj.zero, obj.pri, obj.pal);

  // Choose subscreen pixel by priority among enabled TS layers
  let subColor: number = backColor;
  const useFixedWhenNoSub = (ppu.cgwsel & 0x04) !== 0; // simplified: CGWSEL bit2 selects fixed color as subscreen when absent/masked
  let bestSubPri = -1;
  let subLayer = 0; // 0=backdrop, 1=BG1, 2=BG2, 3=BG3, 4=OBJ
  function considerSub(lid: number, layerEnabled: boolean, zero: boolean, pri: number, pal: number) {
    if (!layerEnabled || zero) return;
    if (pri > bestSubPri) { bestSubPri = pri; subColor = ppu.inspectCGRAMWord(pal); subLayer = lid; }
  }
  considerSub(1, subBG1, z1, prio1, pal1);
  considerSub(2, subBG2, z2, prio2, pal2);
  considerSub(3, subBG3, z3, prio3, pal3);
  considerSub(4, subOBJ, obj.zero, obj.pri, obj.pal);
  if (useFixedWhenNoSub && bestSubPri < 0) {
    subColor = ((ppu.fixedR & 0x1f) << 10) | ((ppu.fixedG & 0x1f) << 5) | (ppu.fixedB & 0x1f);
  }

    let outColor = mainColor;
    // Apply color math only if globally enabled and the main layer is selected in mask (or mask==0 applies to all)
    let mainAffected = (mask === 0) || (mainLayer === 1 && (mask & 0x01)) || (mainLayer === 2 && (mask & 0x02)) || (mainLayer === 3 && (mask & 0x04)) || (mainLayer === 4 && (mask & 0x10));

    // Window gate: per-layer A/B enables via W12SEL/W34SEL/WOBJSEL.
    // Mapping (simplified):
    //  - W12SEL: BG1 A=bit0, B=bit1; BG2 A=bit2, B=bit3
    //  - W34SEL: BG3 A=bit0, B=bit1; BG4 A=bit2, B=bit3
    //  - WOBJSEL: OBJ A=bit0, B=bit1
    let useA = false, useB = false;
    let invA = false, invB = false;
    if (mainLayer === 1) { useA = (ppu.w12sel & 0x01) !== 0; useB = (ppu.w12sel & 0x02) !== 0; invA = (ppu.w12sel & 0x10) !== 0; invB = (ppu.w12sel & 0x20) !== 0; }
    else if (mainLayer === 2) { useA = (ppu.w12sel & 0x04) !== 0; useB = (ppu.w12sel & 0x08) !== 0; invA = (ppu.w12sel & 0x40) !== 0; invB = (ppu.w12sel & 0x80) !== 0; }
    else if (mainLayer === 3) { useA = (ppu.w34sel & 0x01) !== 0; useB = (ppu.w34sel & 0x02) !== 0; invA = (ppu.w34sel & 0x10) !== 0; invB = (ppu.w34sel & 0x20) !== 0; }
    else if (mainLayer === 4) { useA = (ppu.wobjsel & 0x01) !== 0; useB = (ppu.wobjsel & 0x02) !== 0; invA = (ppu.wobjsel & 0x10) !== 0; invB = (ppu.wobjsel & 0x20) !== 0; }

    if (useA || useB) {
      const aHit = useA ? inA(x) : false;
      const bHit = useB ? inB(x) : false;
      const aEff = invA ? !aHit : aHit;
      const bEff = invB ? !bHit : bHit;
      const inWindow = combineWin(aEff, bEff);
      if (applyInside !== inWindow) mainAffected = false;
    }

    // Optional subscreen window gating (CGWSEL bit1): mask subColor by windows using same mapping
    const subGate = (ppu.cgwsel & 0x02) !== 0;
    if (subGate && subLayer !== 0) {
      let sUseA = false, sUseB = false;
      let sInvA = false, sInvB = false;
      if (subLayer === 1) { sUseA = (ppu.w12sel & 0x01) !== 0; sUseB = (ppu.w12sel & 0x02) !== 0; sInvA = (ppu.w12sel & 0x10) !== 0; sInvB = (ppu.w12sel & 0x20) !== 0; }
      else if (subLayer === 2) { sUseA = (ppu.w12sel & 0x04) !== 0; sUseB = (ppu.w12sel & 0x08) !== 0; sInvA = (ppu.w12sel & 0x40) !== 0; sInvB = (ppu.w12sel & 0x80) !== 0; }
      else if (subLayer === 3) { sUseA = (ppu.w34sel & 0x01) !== 0; sUseB = (ppu.w34sel & 0x02) !== 0; sInvA = (ppu.w34sel & 0x10) !== 0; sInvB = (ppu.w34sel & 0x20) !== 0; }
      else if (subLayer === 4) { sUseA = (ppu.wobjsel & 0x01) !== 0; sUseB = (ppu.wobjsel & 0x02) !== 0; sInvA = (ppu.wobjsel & 0x10) !== 0; sInvB = (ppu.wobjsel & 0x20) !== 0; }
      if (sUseA || sUseB) {
        const aHit = sUseA ? inA(x) : false;
        const bHit = sUseB ? inB(x) : false;
        const aEff = sInvA ? !aHit : aHit;
        const bEff = sInvB ? !bHit : bHit;
        const sIn = combineWin(aEff, bEff);
        if (applyInside !== sIn) {
          subColor = useFixedWhenNoSub ? (((ppu.fixedR & 0x1f) << 10) | ((ppu.fixedG & 0x1f) << 5) | (ppu.fixedB & 0x1f)) : backColor;
        }
      }
    }

    if (globalEnable && mainAffected) {
      const mr = (mainColor >> 10) & 0x1f; const mg = (mainColor >> 5) & 0x1f; const mb = mainColor & 0x1f;
      const sr = (subColor >> 10) & 0x1f; const sg = (subColor >> 5) & 0x1f; const sb = subColor & 0x1f;
      let r = subtract ? (mr - sr) : (mr + sr);
      let g = subtract ? (mg - sg) : (mg + sg);
      let b = subtract ? (mb - sb) : (mb + sb);
      if (!subtract) { r = Math.min(31, r); g = Math.min(31, g); b = Math.min(31, b); }
      if (subtract) { r = Math.max(0, r); g = Math.max(0, g); b = Math.max(0, b); }
      if (half) { r >>= 1; g >>= 1; b >>= 1; }
      outColor = ((r & 0x1f) << 10) | ((g & 0x1f) << 5) | (b & 0x1f);
    }

    const { r, g, b, a } = decodeSNESColorToRGBA(outColor);
    const o = i * 4;
    out[o] = Math.round(r * scale);
    out[o + 1] = Math.round(g * scale);
    out[o + 2] = Math.round(b * scale);
    out[o + 3] = a;
  }
  return out;
}

// Render a BG1 region (in pixels) using PPU's BG1 registers (map base, char base, scroll).
export function renderBG1RegionIndices(ppu: PPU, widthPixels: number, heightPixels: number): number[] {
  const out = new Array(widthPixels * heightPixels).fill(0);
  const mapBase = ppu.bg1MapBaseWord;
  const charBase = ppu.bg1CharBaseWord;

  const tileSize = ppu.bg1TileSize16 ? 16 : 8;
  const mapWidth = ppu.bg1MapWidth64 ? 64 : 32;
  const mapHeight = ppu.bg1MapHeight64 ? 64 : 32;

  for (let y = 0; y < heightPixels; y++) {
    for (let x = 0; x < widthPixels; x++) {
      const worldX = (x + ppu.bg1HOfs) >>> 0;
      const worldY = (y + ppu.bg1VOfs) >>> 0;

      // Determine tilemap coordinates based on configured tile size
      let tileX = Math.floor(worldX / tileSize) % mapWidth;
      let tileY = Math.floor(worldY / tileSize) % mapHeight;
      if (tileX < 0) tileX += mapWidth;
      if (tileY < 0) tileY += mapHeight;

      // Pixel within the selected tile (before flip handling)
      let inTileX = worldX % tileSize; if (inTileX < 0) inTileX += tileSize;
      let inTileY = worldY % tileSize; if (inTileY < 0) inTileY += tileSize;

      // Handle 64x32/32x64/64x64 screen arrangements
      let screenOffset = 0; // in words
      if (ppu.bg1MapWidth64 && tileX >= 32) { tileX -= 32; screenOffset += 0x400; }
      if (ppu.bg1MapHeight64 && tileY >= 32) { tileY -= 32; screenOffset += 0x800; }

      const entry = ppu.inspectVRAMWord(mapBase + screenOffset + tileY * 32 + tileX);
      const tileIndexBase = entry & 0x03ff; // 8x8 tile index base
      const paletteGroup = (entry >>> 10) & 0x07;
      const xFlip = (entry & 0x4000) !== 0;
      const yFlip = (entry & 0x8000) !== 0;

      if (!ppu.bg1TileSize16) {
        // 8x8 tiles (original behavior)
        const sx = xFlip ? (7 - (inTileX & 7)) : (inTileX & 7);
        const sy = yFlip ? (7 - (inTileY & 7)) : (inTileY & 7);
        const tile = render4bppTileIndices(ppu, charBase, tileIndexBase);
        const pix = tile[sy * 8 + sx];
        out[y * widthPixels + x] = paletteGroup * 16 + pix;
      } else {
        // 16x16 tiles composed of four 8x8 subtiles
        const effX = xFlip ? (15 - inTileX) : inTileX;
        const effY = yFlip ? (15 - inTileY) : inTileY;
        const subX = (effX >> 3) & 1;
        const subY = (effY >> 3) & 1;
        const inSubX = effX & 7;
        const inSubY = effY & 7;

        // Subtile index mapping: right +1, down +16
        const subTileIndex = tileIndexBase + subX + (subY << 4);
        const tile = render4bppTileIndices(ppu, charBase, subTileIndex);
        const pix = tile[inSubY * 8 + inSubX];
        out[y * widthPixels + x] = paletteGroup * 16 + pix;
      }
    }
  }

  return out;
}
