import { IMemoryBus, Byte, Word } from '../emulator/types';

// Minimal memory bus for tests: maps a 24-bit address space to a simple Uint8Array with mirroring where needed.
export class TestMemoryBus implements IMemoryBus {
  // Use 16MB space for now to cover 24-bit address range; large but fine for tests.
  mem: Uint8Array;

  constructor(size = 0x1000000) {
    this.mem = new Uint8Array(size);
  }

  read8(addr: number): Byte {
    return this.mem[addr & 0xffffff];
  }

  read16(addr: number): Word {
    const a = addr & 0xffffff;
    const lo = this.mem[a];
    const hi = this.mem[(a + 1) & 0xffffff];
    return (hi << 8) | lo;
  }

  write8(addr: number, value: Byte): void {
    this.mem[addr & 0xffffff] = value & 0xff;
  }

  write16(addr: number, value: Word): void {
    const a = addr & 0xffffff;
    this.mem[a] = value & 0xff;
    this.mem[(a + 1) & 0xffffff] = (value >>> 8) & 0xff;
  }
}

