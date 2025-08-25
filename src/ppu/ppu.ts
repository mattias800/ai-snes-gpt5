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

  // VRAM addressing
  private vmain = 0x00; // $2115
  private vaddr = 0x0000; // $2116/7 (word address)
  private vramReadLowNext = true; // track read phase for $2139/$213A

  // CGRAM addressing
  private cgadd = 0x00; // $2121 (byte index)

  // OAM addressing
  private oamAddr = 0x000; // 0..543

  // BG1 registers (subset)
  public bg1MapBaseWord = 0;   // computed from $2107
  public bg1CharBaseWord = 0;  // computed from $210B
  public bg1HOfs = 0;          // pixels
  public bg1VOfs = 0;          // pixels
  private bg1HOfsLatchLow = 0;
  private bg1HOfsPhase = 0; // 0=expect low, 1=expect high
  private bg1VOfsLatchLow = 0;
  private bg1VOfsPhase = 0;

  // Helpers
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
    // If bit 7 = 0 -> increment after high; if 1 -> after low (as implemented here)
    return (this.vmain & 0x80) === 0;
  }
  private incVAddr(): void {
    this.vaddr = (this.vaddr + this.vramStepWords()) & 0xffff;
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
  }
  endScanline(): void {
    this.scanline++;
    if (this.scanline >= 262) {
      this.frame++;
      this.scanline = 0;
    }
  }

  // MMIO read/write entry points (addr is low byte 0x00..0xFF for $21xx)
  readReg(addr: number): number {
    addr &= 0xff;
    switch (addr) {
      // VRAM read: $2139 (low), $213A (high)
      case 0x39: {
        const w = this.vram[this.vaddr & 0x7fff];
        const v = w & 0xff;
        if (!this.incOnHigh()) this.incVAddr(); // increment after low when bit7=1
        this.vramReadLowNext = false;
        this.regs[addr] = v;
        return v;
      }
      case 0x3a: {
        const w = this.vram[this.vaddr & 0x7fff];
        const v = (w >>> 8) & 0xff;
        if (this.incOnHigh()) this.incVAddr(); // increment after high when bit7=0
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
        // Store only; brightness not modeled yet
        break;
      }
      case 0x15: { // VMAIN ($2115)
        this.vmain = v;
        break;
      }
      case 0x07: { // BG1SC ($2107)
        // Bits 2-7: tilemap base address in VRAM, units of 0x400 bytes => words offset = ((v & 0xFC)>>2) * 0x200
        this.bg1MapBaseWord = (v & 0xfc) << 7; // ((v & 0xFC) >> 2) << 9 == (v & 0xFC) << 7
        break;
      }
      case 0x0b: { // BG12NBA ($210B)
        // Bits 4-7: BG1 char base in units of 0x1000 bytes => words offset = nibble * 0x800
        this.bg1CharBaseWord = ((v >> 4) & 0x0f) << 11;
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
        const idx = this.vaddr & 0x7fff;
        const cur = this.vram[idx];
        const next = (cur & 0xff00) | v;
        this.vram[idx] = next;
        if (!this.incOnHigh()) this.incVAddr();
        break;
      }
      case 0x19: { // VMDATAH ($2119)
        const idx = this.vaddr & 0x7fff;
        const cur = this.vram[idx];
        const next = (cur & 0x00ff) | (v << 8);
        this.vram[idx] = next;
        if (this.incOnHigh()) this.incVAddr();
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
