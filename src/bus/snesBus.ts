import { IMemoryBus, Byte, Word } from '../emulator/types';
import { Cartridge } from '../cart/cartridge';
import { PPU } from '../ppu/ppu';

// Partial SNES Bus focusing on ROM, WRAM, MMIO, and basic DMA for tests.
export class SNESBus implements IMemoryBus {
  // 128 KiB WRAM at 0x7E:0000-0x7F:FFFF
  private wram = new Uint8Array(128 * 1024);

  // PPU device handling $2100-$21FF
  private ppu = new PPU();

  // Expose PPU for integration tests and emulator orchestration
  public getPPU(): PPU {
    return this.ppu;
  }

  // DMA channel registers (8 channels, base $4300 + 0x10*ch)
  private dmap = new Uint8Array(8);   // $43x0
  private bbad = new Uint8Array(8);   // $43x1
  private a1tl = new Uint16Array(8);  // $43x2-$43x3 (little endian)
  private a1b = new Uint8Array(8);    // $43x4
  private das = new Uint16Array(8);   // $43x5-$43x6

  constructor(private cart: Cartridge) {}

  // Internal helper to access WRAM linear index
  private wramIndex(bank: number, off: number): number {
    return ((bank & 1) << 16) | off;
  }

  private mapRead(addr: number): Byte {
    const bank = (addr >>> 16) & 0xff;
    const off = addr & 0xffff;

    // WRAM mirrors
    if (bank === 0x7e || bank === 0x7f) {
      return this.wram[this.wramIndex(bank, off)];
    }

    // PPU MMIO $2100-$21FF
    if ((off & 0xff00) === 0x2100) {
      return this.ppu.readReg(off & 0x00ff);
    }

    // APU/io ranges not implemented for read

    // ROM mapping (simplified LoROM/HiROM)
    if (this.cart.mapping === 'lorom') {
      // LoROM: banks 0x00-0x7D, 0x80-0xFF: 0x8000-0xFFFF map to ROM in 32KiB chunks
      if (off >= 0x8000) {
        const loBank = bank & 0x7f;
        const romAddr = (loBank * 0x8000) + (off - 0x8000);
        return this.cart.rom[romAddr % this.cart.rom.length];
      }
    } else {
      // HiROM: banks 0x40-0x7D, 0xC0-0xFF: 0x0000-0xFFFF map to ROM in 64KiB chunks
      const hiBank = bank & 0x7f;
      const romAddr = (hiBank * 0x10000) + off;
      return this.cart.rom[romAddr % this.cart.rom.length];
    }

    // Default open bus 0x00
    return 0x00;
  }

  private performMDMA(mask: Byte): void {
    for (let ch = 0; ch < 8; ch++) {
      if ((mask & (1 << ch)) === 0) continue;
      const mode = this.dmap[ch] & 0x07;
      const dirBtoA = (this.dmap[ch] & 0x80) !== 0; // 1 = B->A, 0 = A->B
      const baseB = this.bbad[ch]; // $21xx base
      let aAddr = this.a1tl[ch];
      const aBank = this.a1b[ch];
      let count = this.das[ch] || 0x10000; // 0 means 65536 bytes in hardware; here handle 0 as 0x10000

      while (count > 0) {
        // Determine B address per mode (support mode 0 and 1 only)
        let bOff = baseB;
        if (mode === 1) {
          // Alternate between base and base+1 per transfer
          const toggled = ((this.das[ch] - count) & 1) !== 0;
          bOff = baseB + (toggled ? 1 : 0);
        }
        const bAddr = 0x002100 | (bOff & 0xff);

        if (dirBtoA) {
          const val = this.mapRead(bAddr);
          // write to A-bus location
          const la = ((aBank << 16) | aAddr) >>> 0;
          this.write8(la, val);
        } else {
          // A->B
          const la = ((aBank << 16) | aAddr) >>> 0;
          const val = this.read8(la);
          this.mapWrite(bAddr, val);
        }

        // Increment A address (mode 0/1 always increment)
        aAddr = (aAddr + 1) & 0xffff;
        count--;
      }

      // Update channel registers post-transfer
      this.a1tl[ch] = aAddr;
      this.das[ch] = 0;
    }
  }

  private mapWrite(addr: number, value: Byte): void {
    const bank = (addr >>> 16) & 0xff;
    const off = addr & 0xffff;

    if (bank === 0x7e || bank === 0x7f) {
      this.wram[this.wramIndex(bank, off)] = value & 0xff;
      return;
    }

    // PPU MMIO $2100-$21FF
    if ((off & 0xff00) === 0x2100) {
      this.ppu.writeReg(off & 0x00ff, value & 0xff);
      return;
    }

    // DMA registers $4300-$437F
    if (off >= 0x4300 && off <= 0x437f) {
      const ch = (off - 0x4300) >> 4; // 0..7
      const reg = off & 0x000f;
      switch (reg) {
        case 0x0: this.dmap[ch] = value & 0xff; break;      // DMAP
        case 0x1: this.bbad[ch] = value & 0xff; break;      // BBAD
        case 0x2: this.a1tl[ch] = (this.a1tl[ch] & 0xff00) | value; break; // A1T low
        case 0x3: this.a1tl[ch] = (this.a1tl[ch] & 0x00ff) | (value << 8); break; // A1T high
        case 0x4: this.a1b[ch] = value & 0xff; break;       // A1B
        case 0x5: this.das[ch] = (this.das[ch] & 0xff00) | value; break; // DAS low
        case 0x6: this.das[ch] = (this.das[ch] & 0x00ff) | (value << 8); break; // DAS high
        // Others ignored for now
      }
      return;
    }

    // MDMAEN $420B
    if (off === 0x420b) {
      this.performMDMA(value & 0xff);
      return;
    }

    // TODO: Other MMIO, SRAM, etc.
  }

  read8(addr: number): Byte {
    return this.mapRead(addr & 0xffffff);
  }

  read16(addr: number): Word {
    const a = addr & 0xffffff;
    const lo = this.read8(a);
    const hi = this.read8((a + 1) & 0xffffff);
    return (hi << 8) | lo;
  }

  write8(addr: number, value: Byte): void {
    this.mapWrite(addr & 0xffffff, value & 0xff);
  }

  write16(addr: number, value: Word): void {
    const a = addr & 0xffffff;
    this.write8(a, value & 0xff);
    this.write8((a + 1) & 0xffffff, (value >>> 8) & 0xff);
  }
}

