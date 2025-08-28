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
    const a = addr & 0xffffff;
    this.mem[a] = value & 0xff;
    try {
      // @ts-ignore
      const dbg = (globalThis as any).process?.env?.CPU_DEBUG === '1';
      if (dbg && ((a & 0xffff) === 0x01ff || (a & 0xffff) === 0x0100)) {
        // eslint-disable-next-line no-console
        console.log(`[BUS] W ${((a>>>16)&0xff).toString(16).padStart(2,'0')}:${(a&0xffff).toString(16).padStart(4,'0')} <= ${((value)&0xff).toString(16).padStart(2,'0')}`);
      }
    } catch { /* noop */ }
  }

  write16(addr: number, value: Word): void {
    const a = addr & 0xffffff;
    this.mem[a] = value & 0xff;
    this.mem[(a + 1) & 0xffffff] = (value >>> 8) & 0xff;
  }
}

