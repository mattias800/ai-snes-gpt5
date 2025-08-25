import { IMemoryBus, Byte, Word } from '../emulator/types';
import { Cartridge, Mapping } from '../cart/cartridge';

// Partial SNES Bus focusing on ROM and WRAM for reset/CPU tests.
export class SNESBus implements IMemoryBus {
  // 128 KiB WRAM at 0x7E:0000-0x7F:FFFF
  private wram = new Uint8Array(128 * 1024);

  constructor(private cart: Cartridge) {}

  private mapRead(addr: number): Byte {
    const bank = (addr >>> 16) & 0xff;
    const off = addr & 0xffff;

    // WRAM mirrors
    if (bank === 0x7e || bank === 0x7f) {
      return this.wram[((bank & 1) << 16) | off];
    }

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

  private mapWrite(addr: number, value: Byte): void {
    const bank = (addr >>> 16) & 0xff;
    const off = addr & 0xffff;

    if (bank === 0x7e || bank === 0x7f) {
      this.wram[((bank & 1) << 16) | off] = value & 0xff;
      return;
    }

    // TODO: MMIO, SRAM, etc.
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

