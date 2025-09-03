export class PPU {
  // VRAM: 32K words (64KB), addressed by word
  private vram = new Uint16Array(0x8000);
  // CGRAM: 256 colors x 2 bytes
  private cgram = new Uint8Array(512);
  // OAM: 544 bytes
  private oam = new Uint8Array(544);

  // MMIO mirrors for last written values (for tests and DMA readability)
  private regs = new Uint8Array(0x100);

  // Minimal timing counters for tests
  public scanline = 0; // 0..261
  public frame = 0;
  public hblank = false; // coarse H-Blank flag (bit6 of $4212 via bus)

  // Display control (INIDISP $2100)
  public brightness = 0x0f; // 0..15 (default full brightness)
  public forceBlank = false;
  // Layer designation (TM/TS: $212C/$212D)
  public tm = 0x01; // enable BG1 on main by default for tests
  public ts = 0x00; // subscreen unused in our renderer
  // Color math registers (minimal)
  public cgwsel = 0x00; // $2130 (window + math control; simplified)
  public cgadsub = 0x00; // $2131 (add/sub, half, mask)
  // Fixed color (COLDATA $2132 simplified)
  public fixedR = 0; // 0..31
  public fixedG = 0; // 0..31
  public fixedB = 0; // 0..31

  // VRAM addressing
  private vmain = 0x00; // $2115 (bit2 selects increment-after-HIGH; default 0 = after LOW)
  private vaddr = 0x0000; // $2116/7 (word address)
  private vramReadLowNext = true; // track read phase for $2139/$213A
  private vramReadLatchWord = 0x0000; // latch word for paired $2139/$213A reads

  // VRAM write latch to ensure $2118/$2119 commit to the same address when increment-after-low is selected
  private vramWriteLatchLow = 0x00;
  private vramWriteLatchHigh = 0x00;
  private vramWriteAddrLatch = 0x0000;
  private vramWriteHasLow = false;
  private vramWriteHasHigh = false;

  // Optional VRAM commit debug logging
  private vramCommitLogEnabled = false;
  private vramCommitLogRemaining = 0;
  private vramCommitLogFrom = 0;
  private vramCommitLogTo = 0x7fff;

  // CGRAM addressing
  private cgadd = 0x00; // $2121 (byte index)

  // OAM addressing
  private oamAddr = 0x000; // 0..543

  // BG1 registers (subset)
  public bg1MapBaseWord = 0;   // computed from $2107
  public bg1CharBaseWord = 0;  // computed from $210B (high nibble)
  public bg1HOfs = 0;          // pixels
  public bg1VOfs = 0;          // pixels
  private bg1HOfsLatchLow = 0;
  private bg1HOfsPhase = 0; // 0=expect low, 1=expect high
  private bg1VOfsLatchLow = 0;
  private bg1VOfsPhase = 0;

  // BG2 registers (subset)
  public bg2MapBaseWord = 0;   // computed from $2108
  public bg2CharBaseWord = 0;  // computed from $210B (low nibble)
  public bg2HOfs = 0;
  public bg2VOfs = 0;
  private bg2HOfsLatchLow = 0;
  private bg2HOfsPhase = 0;
  private bg2VOfsLatchLow = 0;
  private bg2VOfsPhase = 0;
  public bg2MapWidth64 = false;  // $2108 bits 0-1
  public bg2MapHeight64 = false;

  // BG3 registers (subset)
  public bg3MapBaseWord = 0;   // $2109
  public bg3CharBaseWord = 0;  // $210C high nibble
  public bg3HOfs = 0;
  public bg3VOfs = 0;
  private bg3HOfsLatchLow = 0;
  private bg3HOfsPhase = 0;
  private bg3VOfsLatchLow = 0;
  private bg3VOfsPhase = 0;

  // BG4 registers (subset)
  public bg4MapBaseWord = 0;   // $210A
  public bg4CharBaseWord = 0;  // $210C low nibble
  public bg4HOfs = 0;
  public bg4VOfs = 0;
  private bg4HOfsLatchLow = 0;
  private bg4HOfsPhase = 0;
  private bg4VOfsLatchLow = 0;
  private bg4VOfsPhase = 0;

  // BG mode and size
  public bgMode = 0;           // $2105 bits 0-2
  public bg1TileSize16 = false; // $2105 bit 4

  // OBJ settings (subset)
  public objCharBaseWord = 0;  // computed from $2101 (OBSEL), simplified mapping
  public objSize16 = false;    // simplified: OBSEL bit4 => 16x16, else 8x8

  // Windowing (very simplified)
  public w12sel = 0x00;        // $2123: window enable flags for BG1/BG2 (simplified)
  public w34sel = 0x00;        // $2124: window enable flags for BG3/BG4 (simplified)
  public wobjsel = 0x00;       // $2125: window enable flags for OBJ/backdrop (simplified; use bit0 for OBJ)
  public wh0 = 0;              // $2126: window 1 left
  public wh1 = 255;            // $2127: window 1 right
  public wh2 = 0;              // $2128: window 2 left
  public wh3 = 255;            // $2129: window 2 right

  // Feature flags for testing alternate semantics
  public cgwStrictMaskMode = true; // when true, do not require CGADSUB bit5 as a global enable

  public bg1MapWidth64 = false;  // $2107 bits 0-1
  public bg1MapHeight64 = false;

  // Helpers
  constructor() {
    try {
      // @ts-ignore
      const env = (globalThis as any).process?.env ?? {};
      const n = Number(env.SMW_LOG_VRAM_COMMITS ?? '0');
      if (Number.isFinite(n) && n > 0) {
        this.vramCommitLogEnabled = true;
        this.vramCommitLogRemaining = (n | 0);
        const rangeRaw = (env.SMW_LOG_VRAM_RANGE ?? '').toString().trim();
        if (rangeRaw) {
          const m = rangeRaw.replace(/^\$/,'').toLowerCase().match(/^([0-9a-fx]+)\-([0-9a-fx]+)$/);
          if (m) {
            const parseHex = (s: string) => s.startsWith('0x') ? Number(s) : parseInt(s, 16);
            const a = parseHex(m[1]);
            const b = parseHex(m[2]);
            if (Number.isFinite(a) && Number.isFinite(b)) {
              this.vramCommitLogFrom = Math.max(0, Math.min(0x7fff, a|0));
              this.vramCommitLogTo = Math.max(0, Math.min(0x7fff, b|0));
              if (this.vramCommitLogFrom > this.vramCommitLogTo) {
                const t = this.vramCommitLogFrom; this.vramCommitLogFrom = this.vramCommitLogTo; this.vramCommitLogTo = t;
              }
            }
          }
        }
      }
    } catch { /* noop */ }
  }

  private vramStepWords(): number {
    const stepSel = this.vmain & 0x03;
    switch (stepSel) {
      case 0: return 1;   // +1 word
      case 1: return 32;  // +32 words
      case 2: return 128; // +128 words
      case 3: return 128; // +128 words (mirrors on real HW)
      default: return 1;
    }
  }
  private incOnHigh(): boolean {
    // Hardware semantics (VMAIN $2115):
    // - bit7 = 1 -> increment after HIGH byte ($2119)
    // - bit7 = 0 -> increment after LOW byte ($2118)
    return (this.vmain & 0x80) !== 0;
  }
  private incVAddr(): void {
    this.vaddr = (this.vaddr + this.vramStepWords()) & 0xffff;
  }

  // Translate logical VADDR (word address) to physical VRAM word address based on VMAIN full-graphic mode.
  private physVRAMAddr(addr: number): number {
    const a = addr & 0x7fff; // 15-bit word address space
    const fgMode = (this.vmain >> 2) & 0x03; // 0=linear, 1=2bpp, 2=4bpp, 3=8bpp
    if (fgMode === 0) return a;
    const idx = fgMode - 1; // 0->2bpp, 1->4bpp, 2->8bpp
    const row = a & 0x0007; // 0..7 row within 8x8 tile
    const wordsPerRow = 1 << idx; // 2bpp:1, 4bpp:2, 8bpp:4 words per tile row
    const wordInRowMask = wordsPerRow - 1;
    const wordInRow = (wordInRowMask > 0) ? ((a >> 3) & wordInRowMask) : 0;
    const tileX = (a >> (3 + idx)) & 0x001f; // 0..31
    const tileY = (a >> (3 + idx + 5)) & 0x001f; // 0..31
    const wordsPerPageRow = 32 * wordsPerRow; // words across one row of 32 tiles
    const withinPage = (((tileY * 8) + row) * wordsPerPageRow) + (tileX * wordsPerRow) + wordInRow;
    const pageShift = 13 + idx; // bits consumed within a page
    const pageBase = (a >> pageShift) << pageShift; // keep page-select upper bits
    const phys = pageBase + withinPage;
    return phys & 0x7fff;
  }

  // Expose for tests
  inspectVRAMWord(addr: number): number {
    return this.vram[addr & 0x7fff];
  }
  inspectCGRAMWord(index: number): number {
    const i = (index & 0xff) * 2;
    return this.cgram[i] | (this.cgram[i + 1] << 8);
  }
  inspectOAMByte(addr: number): number {
    return this.oam[addr % 544];
  }

  // Timing hooks (minimal)
  startFrame(): void {
    this.scanline = 0;
    this.hblank = false;
  }
  endScanline(): void {
    this.scanline++;
    if (this.scanline >= 262) {
      this.frame++;
      this.scanline = 0;
    }
    // Clear hblank at end of each scanline; scheduler will toggle during next scanline
    this.hblank = false;
  }

  // MMIO read/write entry points (addr is low byte 0x00..0xFF for $21xx)
  readReg(addr: number): number {
    addr &= 0xff;
    switch (addr) {
      // VRAM read: $2139 (low), $213A (high)
      case 0x39: {
        // Latch the current word and return low byte.
        // If bit7=0 (increment-after-LOW), the increment occurs now after reading low.
        this.vramReadLatchWord = this.vram[this.physVRAMAddr(this.vaddr)] & 0xffff;
        const v = this.vramReadLatchWord & 0xff;
        if (!this.incOnHigh()) this.incVAddr(); // increment-after-LOW
        this.vramReadLowNext = false;
        this.regs[addr] = v;
        return v;
      }
      case 0x3a: {
        // Return high byte from the latched word.
        // If bit7=1 (increment-after-HIGH), the increment occurs now after reading high.
        const v = (this.vramReadLatchWord >>> 8) & 0xff;
        if (this.incOnHigh()) this.incVAddr(); // increment-after-HIGH
        this.vramReadLowNext = true;
        this.regs[addr] = v;
        return v;
      }

      // CGRAM read $213B
      case 0x3b: {
        const v = this.cgram[this.cgadd & 0x1ff];
        this.cgadd = (this.cgadd + 1) & 0x1ff;
        this.regs[addr] = v;
        return v;
      }

      // OAMDATA read $2138
      case 0x38: {
        const v = this.oam[this.oamAddr % 544];
        this.oamAddr = (this.oamAddr + 1) % 544;
        this.regs[addr] = v;
        return v;
      }

      default:
        return this.regs[addr] | 0;
    }
  }

  writeReg(addr: number, value: number): void {
    addr &= 0xff;
    const v = value & 0xff;
    this.regs[addr] = v;

    switch (addr) {
      case 0x00: { // INIDISP ($2100)
        // bit7 = forced blank, bits0-3 = brightness
        this.forceBlank = (v & 0x80) !== 0;
        this.brightness = v & 0x0f;
        break;
      }
      case 0x01: { // OBSEL ($2101) - simplified: set OBJ char base and size
        // On real HW, bits select base/size; here simplify:
        // - low nibble -> base in units of 0x1000 bytes
        // - bit4 -> 1 = 16x16 sprites, 0 = 8x8 sprites
        this.objCharBaseWord = (v & 0x0f) << 11; // words offset
        this.objSize16 = (v & 0x10) !== 0;
        break;
      }
      case 0x15: { // VMAIN ($2115)
        this.vmain = v;
        break;
      }
      case 0x07: { // BG1SC ($2107)
        // Bits 2-7: tilemap base address in VRAM, units of 0x400 bytes => words offset = ((v & 0xFC)>>2) * 0x200
        this.bg1MapBaseWord = (v & 0xfc) << 7; // ((v & 0xFC) >> 2) << 9 == (v & 0xFC) << 7
        // Bits 0-1: screen size (00=32x32, 01=64x32, 10=32x64, 11=64x64)
        const size = v & 0x03;
        this.bg1MapWidth64 = (size === 1) || (size === 3);
        this.bg1MapHeight64 = (size === 2) || (size === 3);
        break;
      }
      case 0x08: { // BG2SC ($2108)
        // Same encoding as BG1SC
        this.bg2MapBaseWord = (v & 0xfc) << 7;
        // Bits 0-1: screen size (00=32x32, 01=64x32, 10=32x64, 11=64x64)
        const size = v & 0x03;
        this.bg2MapWidth64 = (size === 1) || (size === 3);
        this.bg2MapHeight64 = (size === 2) || (size === 3);
        break;
      }
      case 0x09: { // BG3SC ($2109)
        this.bg3MapBaseWord = (v & 0xfc) << 7;
        break;
      }
      case 0x0a: { // BG4SC ($210A)
        this.bg4MapBaseWord = (v & 0xfc) << 7;
        break;
      }
      case 0x0b: { // BG12NBA ($210B)
        // Hardware mapping:
        // - BG1 char base = LOW nibble * 0x1000 words (0x2000 bytes)
        // - BG2 char base = HIGH nibble * 0x1000 words (0x2000 bytes)
        // Note: Some test ROMs (e.g., cputest/spctest) place tiles at VADDR word $4000 and expect $210B=$04 to select that base.
        // To match that expectation, compute base in words using <<12.
        const low = v & 0x0f;
        const high = (v >> 4) & 0x0f;
        this.bg1CharBaseWord = (low & 0x0f) << 12;
        this.bg2CharBaseWord = (high & 0x0f) << 12;
        break;
      }
      case 0x0c: { // BG34NBA ($210C)
        // Hardware mapping (same units as BG12NBA):
        // - BG3 char base = LOW nibble * 0x1000 words (0x2000 bytes)
        // - BG4 char base = HIGH nibble * 0x1000 words (0x2000 bytes)
        const low = v & 0x0f;
        const high = (v >> 4) & 0x0f;
        this.bg3CharBaseWord = (low & 0x0f) << 12;
        this.bg4CharBaseWord = (high & 0x0f) << 12;
        break;
      }
      case 0x05: { // BGMODE ($2105)
        this.bgMode = v & 0x07;
        this.bg1TileSize16 = (v & 0x10) !== 0;
        // Add BG2 16x16 support via bit5
        // Note: we don't model BG3/BG4 tile sizes here
        // @ts-ignore - declare lazily if not present in older builds
        (this as any).bg2TileSize16 = (v & 0x20) !== 0;
        break;
      }
      case 0x0d: { // BG1HOFS ($210D)
        if (this.bg1HOfsPhase === 0) {
          this.bg1HOfsLatchLow = v;
          this.bg1HOfsPhase = 1;
        } else {
          this.bg1HOfs = ((v & 0x07) << 8) | this.bg1HOfsLatchLow;
          this.bg1HOfsPhase = 0;
        }
        break;
      }
      case 0x0e: { // BG1VOFS ($210E)
        if (this.bg1VOfsPhase === 0) {
          this.bg1VOfsLatchLow = v;
          this.bg1VOfsPhase = 1;
        } else {
          this.bg1VOfs = ((v & 0x07) << 8) | this.bg1VOfsLatchLow;
        
          this.bg1VOfsPhase = 0;
        }
        break;
      }
      case 0x0f: { // BG2HOFS ($210F)
        if (this.bg2HOfsPhase === 0) {
          this.bg2HOfsLatchLow = v;
          this.bg2HOfsPhase = 1;
        } else {
          this.bg2HOfs = ((v & 0x07) << 8) | this.bg2HOfsLatchLow;
          this.bg2HOfsPhase = 0;
        }
        break;
      }
      case 0x10: { // BG2VOFS ($2110)
        if (this.bg2VOfsPhase === 0) {
          this.bg2VOfsLatchLow = v;
          this.bg2VOfsPhase = 1;
        } else {
          this.bg2VOfs = ((v & 0x07) << 8) | this.bg2VOfsLatchLow;
          this.bg2VOfsPhase = 0;
        }
        break;
      }
      case 0x11: { // BG3HOFS ($2111)
        if (this.bg3HOfsPhase === 0) {
          this.bg3HOfsLatchLow = v;
          this.bg3HOfsPhase = 1;
        } else {
          this.bg3HOfs = ((v & 0x07) << 8) | this.bg3HOfsLatchLow;
          this.bg3HOfsPhase = 0;
        }
        break;
      }
      case 0x12: { // BG3VOFS ($2112)
        if (this.bg3VOfsPhase === 0) {
          this.bg3VOfsLatchLow = v;
          this.bg3VOfsPhase = 1;
        } else {
          this.bg3VOfs = ((v & 0x07) << 8) | this.bg3VOfsLatchLow;
          this.bg3VOfsPhase = 0;
        }
        break;
      }
      case 0x13: { // BG4HOFS ($2113)
        if (this.bg4HOfsPhase === 0) {
          this.bg4HOfsLatchLow = v;
          this.bg4HOfsPhase = 1;
        } else {
          this.bg4HOfs = ((v & 0x07) << 8) | this.bg4HOfsLatchLow;
          this.bg4HOfsPhase = 0;
        }
        break;
      }
      case 0x14: { // BG4VOFS ($2114)
        if (this.bg4VOfsPhase === 0) {
          this.bg4VOfsLatchLow = v;
          this.bg4VOfsPhase = 1;
        } else {
          this.bg4VOfs = ((v & 0x07) << 8) | this.bg4VOfsLatchLow;
          this.bg4VOfsPhase = 0;
        }
        break;
      }
      case 0x16: { // VMADDL ($2116)
        this.vaddr = (this.vaddr & 0xff00) | v;
        this.vramReadLowNext = true;
        break;
      }
      case 0x17: { // VMADDH ($2117)
        this.vaddr = (this.vaddr & 0x00ff) | (v << 8);
        this.vramReadLowNext = true;
        break;
      }
      case 0x18: { // VMDATAL ($2118)
        // Latch low byte; if this is the first of the pair, capture the address
        if (!this.vramWriteHasLow && !this.vramWriteHasHigh) {
          this.vramWriteAddrLatch = this.vaddr & 0x7fff;
        }
        this.vramWriteLatchLow = v & 0xff;
        this.vramWriteHasLow = true;
        // Apply address increment timing for LOW if configured
        if (!this.incOnHigh()) this.incVAddr();
        // If we already have a high byte, commit the pair now
        if (this.vramWriteHasHigh) {
          const addr = this.physVRAMAddr(this.vramWriteAddrLatch);
          const word = ((this.vramWriteLatchHigh & 0xff) << 8) | (this.vramWriteLatchLow & 0xff);
          this.vram[addr] = word & 0xffff;
          if (this.vramCommitLogEnabled && this.vramCommitLogRemaining > 0) {
            if (addr >= this.vramCommitLogFrom && addr <= this.vramCommitLogTo) {
              // eslint-disable-next-line no-console
              console.log(`[VRAMCOMMIT] addr=0x${addr.toString(16)} word=0x${word.toString(16).padStart(4,'0')}`);
              this.vramCommitLogRemaining--;
            }
          }
          // Clear pair state
          this.vramWriteHasLow = false;
          this.vramWriteHasHigh = false;
        }
        break;
      }
      case 0x19: { // VMDATAH ($2119)
        // Latch high byte; if this is the first of the pair, capture the address
        if (!this.vramWriteHasLow && !this.vramWriteHasHigh) {
          this.vramWriteAddrLatch = this.vaddr & 0x7fff;
        }
        this.vramWriteLatchHigh = v & 0xff;
        this.vramWriteHasHigh = true;
        // Apply address increment timing for HIGH if configured
        if (this.incOnHigh()) this.incVAddr();
        // If we already have a low byte, commit the pair now
        if (this.vramWriteHasLow) {
          const addr = this.physVRAMAddr(this.vramWriteAddrLatch);
          const word = ((this.vramWriteLatchHigh & 0xff) << 8) | (this.vramWriteLatchLow & 0xff);
          this.vram[addr] = word & 0xffff;
          if (this.vramCommitLogEnabled && this.vramCommitLogRemaining > 0) {
            if (addr >= this.vramCommitLogFrom && addr <= this.vramCommitLogTo) {
              // eslint-disable-next-line no-console
              console.log(`[VRAMCOMMIT] addr=0x${addr.toString(16)} word=0x${word.toString(16).padStart(4,'0')}`);
              this.vramCommitLogRemaining--;
            }
          }
          // Clear pair state
          this.vramWriteHasLow = false;
          this.vramWriteHasHigh = false;
        }
        break;
      }

      case 0x21: { // CGADD ($2121)
        this.cgadd = v & 0xff; // byte index
        break;
      }
      case 0x22: { // CGDATA ($2122)
        this.cgram[this.cgadd & 0x1ff] = v;
        this.cgadd = (this.cgadd + 1) & 0x1ff;
        break;
      }
      case 0x2c: { // TM ($212C) main screen designation
        this.tm = v & 0x1f; // track BG1-4, OBJ bits
        break;
      }
      case 0x2d: { // TS ($212D) subscreen designation
        this.ts = v & 0x1f;
        break;
      }
      case 0x30: { // CGWSEL ($2130)
        this.cgwsel = v & 0xff;
        break;
      }
      case 0x31: { // CGADSUB ($2131)
        this.cgadsub = v & 0xff;
        break;
      }
      case 0x32: { // COLDATA ($2132) simplified: high bits select channel(s), low5 value
        const val5 = v & 0x1f;
        if (v & 0x20) this.fixedR = val5;
        if (v & 0x40) this.fixedG = val5;
        if (v & 0x80) this.fixedB = val5;
        break;
      }

      case 0x23: { // W12SEL ($2123) simplified: bit0=BG1, bit1=BG2
        this.w12sel = v & 0xff;
        break;
      }
      case 0x24: { // W34SEL ($2124) simplified: bit0=BG3, bit1=BG4
        this.w34sel = v & 0xff;
        break;
      }
      case 0x25: { // WOBJSEL ($2125) simplified: bit0=OBJ
        this.wobjsel = v & 0xff;
        break;
      }
      case 0x26: { // WH0 ($2126)
        this.wh0 = v & 0xff;
        break;
      }
      case 0x27: { // WH1 ($2127)
        this.wh1 = v & 0xff;
        break;
      }
      case 0x28: { // WH2 ($2128)
        this.wh2 = v & 0xff;
        break;
      }
      case 0x29: { // WH3 ($2129)
        this.wh3 = v & 0xff;
        break;
      }

      case 0x02: { // OAMADDL ($2102)
        this.oamAddr = (this.oamAddr & 0x300) | v;
        break;
      }
      case 0x03: { // OAMADDH ($2103)
        this.oamAddr = (this.oamAddr & 0x0ff) | ((v & 0x03) << 8);
        break;
      }
      case 0x04: { // OAMDATA ($2104)
        this.oam[this.oamAddr % 544] = v;
        this.oamAddr = (this.oamAddr + 1) % 544;
        break;
      }

      default:
        // For other regs, just mirror the last write
        break;
    }
  }
}
