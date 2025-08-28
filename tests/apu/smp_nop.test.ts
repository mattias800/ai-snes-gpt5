import { describe, it, expect } from 'vitest';
import { SMP } from '../../src/apu/smp';

describe('SMP core minimal execution', () => {
  it('executes NOP and MOV A,#imm without crashing', () => {
    // Simple memory stub: place NOP, MOV A,#0x42
    const mem = new Uint8Array(0x10000);
    mem[0x0200] = 0x00; // NOP
    mem[0x0201] = 0xe8; // MOV A,#imm
    mem[0x0202] = 0x42;
    const bus = {
      read8: (addr: number) => mem[addr & 0xffff] & 0xff,
      write8: (addr: number, v: number) => { mem[addr & 0xffff] = v & 0xff; }
    };
    const smp = new SMP(bus);
    smp.reset();
    smp.PC = 0x0200;
    smp.stepInstruction(); // NOP
    smp.stepInstruction(); // MOV A,#
    expect(smp.A & 0xff).toBe(0x42);
  });
});
