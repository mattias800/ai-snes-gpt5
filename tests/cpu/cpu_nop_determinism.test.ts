import { describe, it, expect } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816 } from '../../src/cpu/cpu65c816';

// Property-style smoke test for determinism of a simple sequence
// We run a sequence of NOPs and ensure the PC advances deterministically.

describe('CPU determinism for NOP stream', () => {
  it('PC advances by 1 per NOP for 256 steps', () => {
    const bus = new TestMemoryBus();
    const start = 0x4000;
    // Write reset vector and fill 256 bytes with NOP (0xEA)
    bus.write8((0x00 << 16) | 0xfffc, start & 0xff);
    bus.write8((0x00 << 16) | 0xfffd, (start >>> 8) & 0xff);
    for (let i = 0; i < 256; i++) {
      bus.write8((0x00 << 16) | ((start + i) & 0xffff), 0xea);
    }

    const cpu = new CPU65C816(bus);
    cpu.reset();
    const pcs: number[] = [];
    for (let i = 0; i < 256; i++) {
      pcs.push(cpu.state.PC);
      cpu.stepInstruction();
    }
    // Expect arithmetic progression
    for (let i = 0; i < 256; i++) {
      expect(pcs[i]).toBe((start + i) & 0xffff);
    }
  });
});

