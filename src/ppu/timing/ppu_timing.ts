import { IPPU } from '../ipu';

// Minimal placeholder for a dot-driven PPU implementation.
// This skeleton lets us wire timing tests without altering the existing simplified PPU.
export class TimingPPU implements IPPU {
  private hDot = 0;      // 0..(dotsPerLine-1)
  private vLine = 0;     // 0..261 (NTSC)
  private frame = 0;     // frame counter
  private hblank = false;
  private vblank = false;

  // HV latch state for $2137/$213C-$213F
  private latchedH = 0;
  private latchedV = 0;
  private latchedHValid = false;
  private latchedVValid = false;

  // Simple backing memories and register mirrors to allow tests to compile as we fill semantics
  private vram = new Uint16Array(0x8000);
  private cgram = new Uint8Array(512);
  private oam = new Uint8Array(544);
  private regs = new Uint8Array(0x100);

  // BG1 registers (subset)
  private bg1MapBaseWord = 0;   // $2107
  private bg1CharBaseWord = 0;  // $210B high nibble
  private bg1HOfs = 0;
  private bg1VOfs = 0;
  private bg1HOfsLatchLow = 0;
  private bg1HOfsPhase = 0;
  private bg1VOfsLatchLow = 0;
  private bg1VOfsPhase = 0;
  private bg1HOfsPending: number | null = null;
  private bg1MapWidth64 = false;
  private bg1MapHeight64 = false;
  private bg1TileSize16 = false;

  // BG2 registers (subset)
  private bg2MapBaseWord = 0;   // $2108
  private bg2CharBaseWord = 0;  // $210B low nibble
  private bg2HOfs = 0;
  private bg2VOfs = 0;
  private bg2HOfsLatchLow = 0;
  private bg2HOfsPhase = 0;
  private bg2VOfsLatchLow = 0;
  private bg2VOfsPhase = 0;
  private bg2HOfsPending: number | null = null;
  private bg2MapWidth64 = false;
  private bg2MapHeight64 = false;
  private bg2TileSize16 = false;

  // BG3 registers (subset)
  private bg3MapBaseWord = 0;   // $2109
  private bg3CharBaseWord = 0;  // $210C high nibble
  private bg3HOfs = 0;
  private bg3VOfs = 0;
  private bg3HOfsLatchLow = 0;
  private bg3HOfsPhase = 0;
  private bg3VOfsLatchLow = 0;
  private bg3VOfsPhase = 0;
  private bg3HOfsPending: number | null = null;
  private bg3MapWidth64 = false;
  private bg3MapHeight64 = false;
  private bg3TileSize16 = false;

  // BG4 registers (subset)
  private bg4MapBaseWord = 0;   // $210A
  private bg4CharBaseWord = 0;  // $210C low nibble
  private bg4HOfs = 0;
  private bg4VOfs = 0;
  private bg4HOfsLatchLow = 0;
  private bg4HOfsPhase = 0;
  private bg4VOfsLatchLow = 0;
  private bg4VOfsPhase = 0;
  private bg4HOfsPending: number | null = null;
  private bg4MapWidth64 = false;
  private bg4MapHeight64 = false;
  private bg4TileSize16 = false;

  // Screen enable (TM $212C)
  private tm = 0x01;
  private ts = 0x00;       // $212D subscreen enable
  private cgwsel = 0x00;   // $2130 window/clip control (ignored for now)
  private cgadsub = 0x00;  // $2131 color math control (we use bits 5=fixed,6=subtract,7=half)
  private coldatar = 0;    // fixed color components 0..31
  private coldatag = 0;
  private coldatab = 0;

  // Windowing (scaffold)
  private w12sel = 0x00;   // $2123 BG1/BG2 window enables (W1/W2 enable/invert pairs)
  private w34sel = 0x00;   // $2124 BG3/BG4 window enables
  private wh0 = 0;         // $2126 window1 left
  private wh1 = 0;         // $2127 window1 right
  private wh2 = 0;         // $2128 window2 left
  private wh3 = 0;         // $2129 window2 right
  private wbglog = 0x00;   // $212A window combination (we treat as OR)

  // VRAM port state
  private vmain = 0x00;        // $2115
  private vaddr = 0x0000;      // $2116/$2117 (word address)
  private vramReadLowNext = true; // next $2139/$213A phase
  private vramReadLatchWord = 0x0000; // latched word for $2139/$213A

  // CGRAM port state
  private cgadd = 0x00;        // $2121 (byte index)
 
  // VRAM write latch (to ensure word writes commit to same address regardless of inc timing)
  private vramWriteLatchLow = 0x00;
  private vramWriteAddrLatch = 0x0000;
 
  // OAM port state
  private oamAddr = 0x000;     // 0..543

  // TODO: finalize constants after integrating validated timing data
  private static readonly DOTS_PER_LINE = 341; // placeholder; to be validated
  private static readonly LINES_PER_FRAME = 262; // NTSC
  private static readonly VBLANK_START_LINE = 224; // coarse; refine to exact dot edge later

  reset = (): void => {
    this.hDot = 0;
    this.vLine = 0;
    this.hblank = false;
    this.vblank = false;
    this.frame = 0;
    this.regs.fill(0);
  };

  // Helpers for VRAM port
  private vramStepWords = (): number => {
    const stepSel = this.vmain & 0x03;
    switch (stepSel) {
      case 0: return 1;
      case 1: return 32;
      case 2: return 128;
      case 3: return 128; // mirror
      default: return 1;
    }
  };
  private incOnHigh = (): boolean => ((this.vmain & 0x80) === 0);
  private incVAddr = (): void => { this.vaddr = (this.vaddr + this.vramStepWords()) & 0xffff; };

  // MMIO
  readReg = (addr: number): number => {
    const a = addr & 0xff;
    switch (a) {
      // OAMDATA read (auto-increment)
      case 0x38: {
        const v = this.oam[this.oamAddr % 544] & 0xff;
        this.oamAddr = (this.oamAddr + 1) % 544;
        this.regs[a] = v; return v;
      }
      // VRAM read low/high ($2139/$213A)
      case 0x39: {
        // Latch the current word and return low byte; increment may occur after low depending on VMAIN
        this.vramReadLatchWord = this.vram[this.vaddr & 0x7fff] & 0xffff;
        const v = this.vramReadLatchWord & 0xff;
        if (!this.incOnHigh()) this.incVAddr();
        this.vramReadLowNext = false;
        this.regs[a] = v; return v;
      }
      case 0x3a: {
        // Return high byte from the latched word, regardless of any address increment after low
        const v = (this.vramReadLatchWord >>> 8) & 0xff;
        if (this.incOnHigh()) this.incVAddr();
        this.vramReadLowNext = true;
        this.regs[a] = v; return v;
      }
      // CGRAM read $213B — increment after each read
      case 0x3b: {
        const v = this.cgram[this.cgadd & 0x1ff] & 0xff;
        this.cgadd = (this.cgadd + 1) & 0x1ff;
        this.regs[a] = v; return v;
      }
      // $213C/$213D: OPHCT low/high (H counter)
      case 0x3c: {
        const src = this.latchedHValid ? this.latchedH : (this.getHCounter());
        const v = src & 0xff; this.regs[a] = v; return v;
      }
      case 0x3d: {
        const src = this.latchedHValid ? this.latchedH : (this.getHCounter());
        const v = (src >>> 8) & 0xff; this.latchedHValid = false; this.regs[a] = v; return v;
      }
      // $213E/$213F: OPVCT low/high (V counter)
      case 0x3e: {
        const src = this.latchedVValid ? this.latchedV : (this.getVCounter());
        const v = src & 0xff; this.regs[a] = v; return v;
      }
      case 0x3f: {
        const src = this.latchedVValid ? this.latchedV : (this.getVCounter());
        const v = (src >>> 8) & 0xff; this.latchedVValid = false; this.regs[a] = v; return v;
      }
      default:
        return this.regs[a] | 0;
    }
  };

  writeReg = (addr: number, value: number): void => {
    const a = addr & 0xff; const v = value & 0xff; this.regs[a] = v;
    switch (a) {
      // INIDISP $2100 — brightness and forced blank
      case 0x00: {
        // mirror only for now; brightness and blanking will apply per-dot later
        break;
      }
      // BG1SC $2107
      case 0x07: {
        this.bg1MapBaseWord = (v & 0xfc) << 7;
        const size = v & 0x03; // 00=32x32,01=64x32,10=32x64,11=64x64
        this.bg1MapWidth64 = (size === 1) || (size === 3);
        this.bg1MapHeight64 = (size === 2) || (size === 3);
        break;
      }
      // BG12NBA $210B
      case 0x0b: {
        this.bg1CharBaseWord = ((v >> 4) & 0x0f) << 11;
        this.bg2CharBaseWord = (v & 0x0f) << 11;
        break;
      }
      // BG34NBA $210C
      case 0x0c: {
        this.bg3CharBaseWord = ((v >> 4) & 0x0f) << 11;
        this.bg4CharBaseWord = (v & 0x0f) << 11;
        break;
      }
      // BGMODE $2105 (bit4: BG1 16x16; bit5: BG2 16x16; bit6: BG3 16x16; bit7: BG4 16x16)
      case 0x05: {
        this.bg1TileSize16 = (v & 0x10) !== 0;
        this.bg2TileSize16 = (v & 0x20) !== 0;
        this.bg3TileSize16 = (v & 0x40) !== 0;
        this.bg4TileSize16 = (v & 0x80) !== 0;
        break;
      }
      // BG1HOFS $210D
      case 0x0d: {
        if (this.bg1HOfsPhase === 0) { this.bg1HOfsLatchLow = v; this.bg1HOfsPhase = 1; }
        else { this.bg1HOfsPending = (((v & 0x07) << 8) | this.bg1HOfsLatchLow) >>> 0; this.bg1HOfsPhase = 0; }
        break;
      }
      // BG1VOFS $210E
      case 0x0e: {
        if (this.bg1VOfsPhase === 0) { this.bg1VOfsLatchLow = v; this.bg1VOfsPhase = 1; }
        else { this.bg1VOfs = (((v & 0x07) << 8) | this.bg1VOfsLatchLow) >>> 0; this.bg1VOfsPhase = 0; }
        break;
      }
      // BG2SC $2108
      case 0x08: {
        this.bg2MapBaseWord = (v & 0xfc) << 7;
        const size = v & 0x03;
        this.bg2MapWidth64 = (size === 1) || (size === 3);
        this.bg2MapHeight64 = (size === 2) || (size === 3);
        break;
      }
      // BG3SC $2109
      case 0x09: {
        this.bg3MapBaseWord = (v & 0xfc) << 7;
        const size = v & 0x03;
        this.bg3MapWidth64 = (size === 1) || (size === 3);
        this.bg3MapHeight64 = (size === 2) || (size === 3);
        break;
      }
      // BG4SC $210A
      case 0x0a: {
        this.bg4MapBaseWord = (v & 0xfc) << 7;
        const size = v & 0x03;
        this.bg4MapWidth64 = (size === 1) || (size === 3);
        this.bg4MapHeight64 = (size === 2) || (size === 3);
        break;
      }
      // BG2HOFS $210F
      case 0x0f: {
        if (this.bg2HOfsPhase === 0) { this.bg2HOfsLatchLow = v; this.bg2HOfsPhase = 1; }
        else { this.bg2HOfsPending = (((v & 0x07) << 8) | this.bg2HOfsLatchLow) >>> 0; this.bg2HOfsPhase = 0; }
        break;
      }
      // BG2VOFS $2110
      case 0x10: {
        if (this.bg2VOfsPhase === 0) { this.bg2VOfsLatchLow = v; this.bg2VOfsPhase = 1; }
        else { this.bg2VOfs = (((v & 0x07) << 8) | this.bg2VOfsLatchLow) >>> 0; this.bg2VOfsPhase = 0; }
        break;
      }
      // BG3HOFS $2111
      case 0x11: {
        if (this.bg3HOfsPhase === 0) { this.bg3HOfsLatchLow = v; this.bg3HOfsPhase = 1; }
        else { this.bg3HOfsPending = (((v & 0x07) << 8) | this.bg3HOfsLatchLow) >>> 0; this.bg3HOfsPhase = 0; }
        break;
      }
      // BG3VOFS $2112
      case 0x12: {
        if (this.bg3VOfsPhase === 0) { this.bg3VOfsLatchLow = v; this.bg3VOfsPhase = 1; }
        else { this.bg3VOfs = (((v & 0x07) << 8) | this.bg3VOfsLatchLow) >>> 0; this.bg3VOfsPhase = 0; }
        break;
      }
      // BG4HOFS $2113
      case 0x13: {
        if (this.bg4HOfsPhase === 0) { this.bg4HOfsLatchLow = v; this.bg4HOfsPhase = 1; }
        else { this.bg4HOfsPending = (((v & 0x07) << 8) | this.bg4HOfsLatchLow) >>> 0; this.bg4HOfsPhase = 0; }
        break;
      }
      // BG4VOFS $2114
      case 0x14: {
        if (this.bg4VOfsPhase === 0) { this.bg4VOfsLatchLow = v; this.bg4VOfsPhase = 1; }
        else { this.bg4VOfs = (((v & 0x07) << 8) | this.bg4VOfsLatchLow) >>> 0; this.bg4VOfsPhase = 0; }
        break;
      }
      // TM $212C
      case 0x2c: {
        this.tm = v & 0x1f;
        break;
      }
      // TS $212D
      case 0x2d: {
        this.ts = v & 0x1f;
        break;
      }
      // CGWSEL $2130 (ignored for now)
      case 0x30: {
        this.cgwsel = v & 0xff;
        break;
      }
      // CGADSUB $2131 (bit5=fixed, bit6=sub, bit7=half)
      case 0x31: {
        this.cgadsub = v & 0xff;
        break;
      }
      // COLDATA $2132 — set fixed color channels; bits 7/6/5 select R/G/B; low 5 bits = value
      case 0x32: {
        const val = v & 0x1f;
        if (v & 0x80) this.coldatar = val;
        if (v & 0x40) this.coldatag = val;
        if (v & 0x20) this.coldatab = val;
        break;
      }
      // VMAIN $2115
      case 0x15: {
        this.vmain = v & 0xff;
        break;
      }
      // W12SEL $2123
      case 0x23: {
        this.w12sel = v & 0xff;
        break;
      }
      // WH0/WH1 $2126/$2127
      case 0x26: {
        this.wh0 = v & 0xff;
        break;
      }
      case 0x27: {
        this.wh1 = v & 0xff;
        break;
      }
      // W34SEL $2124
      case 0x24: {
        this.w34sel = v & 0xff;
        break;
      }
      // WH2/WH3 $2128/$2129
      case 0x28: {
        this.wh2 = v & 0xff;
        break;
      }
      case 0x29: {
        this.wh3 = v & 0xff;
        break;
      }
      // WBGLOG $212A (we ignore combine mode and treat as OR)
      case 0x2a: {
        this.wbglog = v & 0xff;
        break;
      }
      // VMADDL/H $2116/$2117
      case 0x16: {
        this.vaddr = (this.vaddr & 0xff00) | v;
        this.vramReadLowNext = true;
        break;
      }
      case 0x17: {
        this.vaddr = (this.vaddr & 0x00ff) | (v << 8);
        this.vramReadLowNext = true;
        break;
      }
      // VMDATAL/H $2118/$2119
      case 0x18: {
        // Write low byte to latch; remember the address prior to any auto-increment
        this.vramWriteLatchLow = v & 0xff;
        this.vramWriteAddrLatch = this.vaddr & 0x7fff;
        // If increment occurs after low, advance address now
        if (!this.incOnHigh()) this.incVAddr();
        break;
      }
      case 0x19: {
        // On high write, commit the 16-bit word to the latched address (pre-increment if inc-on-low)
        const addr = (!this.incOnHigh()) ? this.vramWriteAddrLatch : (this.vaddr & 0x7fff);
        const low = this.vramWriteLatchLow & 0xff;
        const high = v & 0xff;
        this.vram[addr] = ((high << 8) | low) & 0xffff;
        // If increment occurs after high, advance now
        if (this.incOnHigh()) this.incVAddr();
        break;
      }
      // SLHV $2137 — latch H/V counters
      case 0x37: {
        this.latchedH = this.getHCounter() & 0xffff;
        this.latchedV = this.getVCounter() & 0xffff;
        this.latchedHValid = true;
        this.latchedVValid = true;
        break;
      }
      // CGADD $2121
      case 0x21: {
        this.cgadd = v & 0xff;
        break;
      }
      // CGDATA $2122 — write byte and increment address
      case 0x22: {
        this.cgram[this.cgadd & 0x1ff] = v & 0xff;
        this.cgadd = (this.cgadd + 1) & 0x1ff;
        break;
      }
      // OAM
      case 0x02: case 0x03: case 0x04: {
        if (a === 0x02) { // OAMADDL
          this.oamAddr = (this.oamAddr & 0x300) | v;
        } else if (a === 0x03) { // OAMADDH (bits 0-1)
          this.oamAddr = (this.oamAddr & 0x0ff) | ((v & 0x03) << 8);
        } else if (a === 0x04) { // OAMDATA
          this.oam[this.oamAddr % 544] = v & 0xff;
          this.oamAddr = (this.oamAddr + 1) % 544;
        }
        break;
      }
      default:
        break;
    }
  };

  // Timing advance
  stepDot = (): void => {
    // Update H/V blank based on current dot/line; refine with exact edges later
    if (this.vLine >= TimingPPU.VBLANK_START_LINE) this.vblank = true; else this.vblank = false;
    // Placeholder HBlank window: last ~1/8th of the line
    const hbStart = Math.max(0, Math.floor(TimingPPU.DOTS_PER_LINE * 7 / 8));
    this.hblank = this.hDot >= hbStart;

    // Advance dot
    this.hDot++;
    if (this.hDot >= TimingPPU.DOTS_PER_LINE) {
      this.hDot = 0;
      this.vLine++;
      // At the start of a new line, clear HBlank and recompute VBlank based on new scanline
      this.hblank = false;
      this.vblank = this.vLine >= TimingPPU.VBLANK_START_LINE;
      if (this.vLine >= TimingPPU.LINES_PER_FRAME) {
        this.vLine = 0;
        this.frame++;
        this.vblank = false; // leave VBlank at frame start
      }
    }
  };

  stepScanline = (): void => {
    for (let i = 0; i < TimingPPU.DOTS_PER_LINE; i++) this.stepDot();
  };

  // Queries
  getHCounter = (): number => this.hDot | 0;
  getVCounter = (): number => this.vLine | 0;
  isHBlank = (): boolean => !!this.hblank;
  isVBlank = (): boolean => !!this.vblank;

  // Helpers to read VRAM bytes by word address
  private readVRAMWord = (wordAddr: number): number => this.vram[wordAddr & 0x7fff] & 0xffff;
  private readVRAMByte = (baseWord: number, byteOffset: number): number => {
    const word = this.readVRAMWord(baseWord + (byteOffset >> 1));
    return (byteOffset & 1) ? ((word >>> 8) & 0xff) : (word & 0xff);
  };

  private decode4bppPixel = (charBaseWord: number, tileIndex: number, x: number, y: number): number => {
    const tileWordBase = charBaseWord + tileIndex * 16;
    const row = y & 7;
    const low0 = this.readVRAMByte(tileWordBase, row * 2 + 0);
    const low1 = this.readVRAMByte(tileWordBase, row * 2 + 1);
    const hi0 = this.readVRAMByte(tileWordBase, 16 + row * 2 + 0);
    const hi1 = this.readVRAMByte(tileWordBase, 16 + row * 2 + 1);
    const bit = 7 - (x & 7);
    const p0 = (low0 >> bit) & 1;
    const p1 = (low1 >> bit) & 1;
    const p2 = (hi0 >> bit) & 1;
    const p3 = (hi1 >> bit) & 1;
    return (p3 << 3) | (p2 << 2) | (p1 << 1) | p0;
  };

  private sampleBG = (
    mapBaseWord: number,
    charBaseWord: number,
    mapWidth64: boolean,
    mapHeight64: boolean,
    tileSize16: boolean,
    hOfs: number,
    vOfs: number,
    x: number,
    y: number
  ): number => {
    const res = this.sampleBGEx(
      mapBaseWord, charBaseWord, mapWidth64, mapHeight64, tileSize16, hOfs, vOfs, x, y
    );
    return res.visible ? res.color : 0x0000;
  };

  private sampleBGEx = (
    mapBaseWord: number,
    charBaseWord: number,
    mapWidth64: boolean,
    mapHeight64: boolean,
    tileSize16: boolean,
    hOfs: number,
    vOfs: number,
    x: number,
    y: number
  ): { visible: boolean, color: number, prio: number } => {
    const worldX = (x + hOfs) >>> 0;
    const worldY = (y + vOfs) >>> 0;
    // Determine tilemap cell coordinates based on tile size (8x8 vs 16x16)
    const cellSize = tileSize16 ? 16 : 8;
    let cellX = Math.floor(worldX / cellSize);
    let cellY = Math.floor(worldY / cellSize);
    let screenOffset = 0;
    if (mapWidth64 && cellX >= 32) { cellX -= 32; screenOffset += 0x400; }
    if (mapHeight64 && cellY >= 32) { cellY -= 32; screenOffset += 0x800; }
    const tileX = ((cellX % 32) + 32) % 32;
    const tileY = ((cellY % 32) + 32) % 32;

    const entry = this.readVRAMWord(mapBaseWord + screenOffset + tileY * 32 + tileX);
    const tileIndexBase = entry & 0x03ff;
    const paletteGroup = (entry >>> 10) & 0x07;
    const prio = (entry >>> 13) & 0x01;
    const xFlip = (entry & 0x4000) !== 0;
    const yFlip = (entry & 0x8000) !== 0;

    let pix: number;
    if (!tileSize16) {
      const inX = worldX & 7; const inY = worldY & 7;
      const sx = xFlip ? (7 - inX) : inX;
      const sy = yFlip ? (7 - inY) : inY;
      pix = this.decode4bppPixel(charBaseWord, tileIndexBase, sx, sy) & 0x0f;
    } else {
      const effX = xFlip ? (15 - (worldX & 15)) : (worldX & 15);
      const effY = yFlip ? (15 - (worldY & 15)) : (worldY & 15);
      const subX = (effX >> 3) & 1;
      const subY = (effY >> 3) & 1;
      const inSubX = effX & 7;
      const inSubY = effY & 7;
      const subTileIndex = (tileIndexBase + subX + (subY << 4)) & 0x03ff;
      pix = this.decode4bppPixel(charBaseWord, subTileIndex, inSubX, inSubY) & 0x0f;
    }
    if (pix === 0) return { visible: false, color: 0x0000, prio };
    const palIndex = (paletteGroup * 16 + pix) & 0xff;
    const lo = this.cgram[(palIndex * 2) & 0x1ff] & 0xff;
    const hi = this.cgram[((palIndex * 2 + 1) & 0x1ff)] & 0xff;
    const color = ((hi << 8) | lo) & 0x7fff;
    return { visible: true, color, prio };
  };

  private addSubColors = (cMain: number, cSub: number, subtract: boolean, half: boolean): number => {
    let r = ((cMain >>> 10) & 0x1f);
    let g = ((cMain >>> 5) & 0x1f);
    let b = (cMain & 0x1f);
    const r2 = ((cSub >>> 10) & 0x1f);
    const g2 = ((cSub >>> 5) & 0x1f);
    const b2 = (cSub & 0x1f);
    const op = (a: number, b: number) => subtract ? Math.max(0, a - b) : Math.min(31, a + b);
    r = op(r, r2); g = op(g, g2); b = op(b, b2);
    if (half) { r >>= 1; g >>= 1; b >>= 1; }
    return ((r & 0x1f) << 10) | ((g & 0x1f) << 5) | (b & 0x1f);
  };

  private inWindowForLayer = (layer: number, x: number): boolean => {
    // Determine selector and bit offsets
    let sel = 0; let base = 0;
    if (layer === 1) { sel = this.w12sel; base = 0; }
    else if (layer === 2) { sel = this.w12sel; base = 4; }
    else if (layer === 3) { sel = this.w34sel; base = 0; }
    else if (layer === 4) { sel = this.w34sel; base = 4; }
    else return true;

    const w1e = ((sel >> (base + 0)) & 1) !== 0;
    const w1i = ((sel >> (base + 1)) & 1) !== 0;
    const w2e = ((sel >> (base + 2)) & 1) !== 0;
    const w2i = ((sel >> (base + 3)) & 1) !== 0;

    const inRange = (xl: number, xr: number, px: number): boolean => {
      return (xl <= xr) ? (px >= xl && px <= xr) : (px >= xl || px <= xr);
    };

    const px = x & 0xff;
    let any = false;
    let inWin = false;
    if (w1e) { any = true; let v = inRange(this.wh0, this.wh1, px); if (w1i) v = !v; inWin = inWin || v; }
    if (w2e) { any = true; let v = inRange(this.wh2, this.wh3, px); if (w2i) v = !v; inWin = inWin || v; }
    if (!any) return true; // if no windows apply, allow math everywhere
    return inWin;
  };

  // Per-dot pixel with simple priority: choose highest tile priority; tie-breaker by layer order BG1>BG2>BG3>BG4
  getPixelRGB15 = (): number => {
    // Apply pending HOfs at 8-pixel boundaries at the start of the dot
    if ((this.hDot % 8) === 0) {
      if (this.bg1HOfsPending !== null) { this.bg1HOfs = this.bg1HOfsPending >>> 0; this.bg1HOfsPending = null; }
      if (this.bg2HOfsPending !== null) { this.bg2HOfs = this.bg2HOfsPending >>> 0; this.bg2HOfsPending = null; }
      if (this.bg3HOfsPending !== null) { this.bg3HOfs = this.bg3HOfsPending >>> 0; this.bg3HOfsPending = null; }
      if (this.bg4HOfsPending !== null) { this.bg4HOfs = this.bg4HOfsPending >>> 0; this.bg4HOfsPending = null; }
    }

    const x = this.hDot >>> 0;
    const y = this.vLine >>> 0;

    const enableBG1 = (this.tm & 0x01) !== 0;
    const enableBG2 = (this.tm & 0x02) !== 0;
    const enableBG3 = (this.tm & 0x04) !== 0;
    const enableBG4 = (this.tm & 0x08) !== 0;

    let bestColor = 0x0000;
    let bestPrio = -1;
    let bestLayer = 99;

    const consider = (layer: number, ex: {visible:boolean,color:number,prio:number}) => {
      if (!ex.visible) return;
      if (ex.prio > bestPrio || (ex.prio === bestPrio && layer < bestLayer)) {
        bestPrio = ex.prio;
        bestLayer = layer;
        bestColor = ex.color;
      }
    };

    if (enableBG1) consider(1, this.sampleBGEx(this.bg1MapBaseWord, this.bg1CharBaseWord, this.bg1MapWidth64, this.bg1MapHeight64, this.bg1TileSize16, this.bg1HOfs, this.bg1VOfs, x, y));
    if (enableBG2) consider(2, this.sampleBGEx(this.bg2MapBaseWord, this.bg2CharBaseWord, this.bg2MapWidth64, this.bg2MapHeight64, this.bg2TileSize16, this.bg2HOfs, this.bg2VOfs, x, y));
    if (enableBG3) consider(3, this.sampleBGEx(this.bg3MapBaseWord, this.bg3CharBaseWord, this.bg3MapWidth64, this.bg3MapHeight64, this.bg3TileSize16, this.bg3HOfs, this.bg3VOfs, x, y));
    if (enableBG4) consider(4, this.sampleBGEx(this.bg4MapBaseWord, this.bg4CharBaseWord, this.bg4MapWidth64, this.bg4MapHeight64, this.bg4TileSize16, this.bg4HOfs, this.bg4VOfs, x, y));

    // Simple color math using subscreen if enabled
    const subEnableBG1 = (this.ts & 0x01) !== 0;
    const subEnableBG2 = (this.ts & 0x02) !== 0;
    const subEnableBG3 = (this.ts & 0x04) !== 0;
    const subEnableBG4 = (this.ts & 0x08) !== 0;

    const useFixed = (this.cgadsub & 0x20) !== 0;

    // Per-layer gating: bits 0..3 select BG1..BG4. If none set, default to no math (explicit gating required)
    const gateMask = this.cgadsub & 0x0f;
    const gateBit = (bestLayer >= 1 && bestLayer <= 4) ? (1 << (bestLayer - 1)) : 0;
    const gateOn = (gateMask & gateBit) !== 0;

    // Windowing check for the selected layer
    if (!this.inWindowForLayer(bestLayer, x)) return bestColor;

    if (!gateOn) return bestColor;

    if (this.cgadsub !== 0 && (useFixed || (subEnableBG1 || subEnableBG2 || subEnableBG3 || subEnableBG4))) {
      let subBestColor = 0x0000;
      let subBestPrio = -1;
      let subBestLayer = 99;

      const considerSub = (layer: number, ex: {visible:boolean,color:number,prio:number}) => {
        if (!ex.visible) return;
        if (ex.prio > subBestPrio || (ex.prio === subBestPrio && layer < subBestLayer)) {
          subBestPrio = ex.prio;
          subBestLayer = layer;
          subBestColor = ex.color;
        }
      };

      if (!useFixed) {
        if (subEnableBG1) considerSub(1, this.sampleBGEx(this.bg1MapBaseWord, this.bg1CharBaseWord, this.bg1MapWidth64, this.bg1MapHeight64, this.bg1TileSize16, this.bg1HOfs, this.bg1VOfs, x, y));
        if (subEnableBG2) considerSub(2, this.sampleBGEx(this.bg2MapBaseWord, this.bg2CharBaseWord, this.bg2MapWidth64, this.bg2MapHeight64, this.bg2TileSize16, this.bg2HOfs, this.bg2VOfs, x, y));
        if (subEnableBG3) considerSub(3, this.sampleBGEx(this.bg3MapBaseWord, this.bg3CharBaseWord, this.bg3MapWidth64, this.bg3MapHeight64, this.bg3TileSize16, this.bg3HOfs, this.bg3VOfs, x, y));
        if (subEnableBG4) considerSub(4, this.sampleBGEx(this.bg4MapBaseWord, this.bg4CharBaseWord, this.bg4MapWidth64, this.bg4MapHeight64, this.bg4TileSize16, this.bg4HOfs, this.bg4VOfs, x, y));
      } else {
        // Use fixed color as subscreen
        subBestColor = ((this.coldatar & 0x1f) << 10) | ((this.coldatag & 0x1f) << 5) | (this.coldatab & 0x1f);
      }

      const subtract = (this.cgadsub & 0x40) !== 0;
      const half = (this.cgadsub & 0x80) !== 0;
      return this.addSubColors(bestColor, subBestColor, subtract, half);
    }

    return bestColor;
  };
}

