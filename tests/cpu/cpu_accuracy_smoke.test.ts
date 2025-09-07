import { describe, it, expect, beforeEach } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816, Flag } from '../../src/cpu/cpu65c816';

function setReset(bus: TestMemoryBus, addr: number) {
  // Reset vector at bank 0
  bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
  bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}

// Build a tiny program that exercises the CPU_ACCURATE micro-op path subset
// LDA #, STA dp, LDA dp, ADC dp, DEC dp
function buildProgram8(): { start: number, bytes: number[] } {
  const start = 0x8000;
  const p: number[] = [];
  // LDA #$12
  p.push(0xa9, 0x12);
  // STA $10
  p.push(0x85, 0x10);
  // LDA $10
  p.push(0xa5, 0x10);
  // ADC $10  => A=0x24
  p.push(0x65, 0x10);
  // DEC $10  => mem[$0010] becomes 0x11
  p.push(0xc6, 0x10);
  // BRK (we won't execute it; here for safety if extra steps occur)
  p.push(0x00);
  return { start, bytes: p };
}

describe('CPU_ACCURATE smoke: micro-op subset semantics (8-bit)', () => {
  beforeEach(() => {
    // Ensure accurate mode is on for this test; this also enables micro-ticking per access
    process.env.CPU_ACCURATE = '1';
    // Do not rely on bus timing in this smoke; TestMemoryBus has no timing hooks
    delete process.env.SNES_ACCURATE;
    delete process.env.CPU_MICRO_TICK;
  });

  it('LDA #, STA dp, LDA dp, ADC dp, DEC dp produce correct A, flags, and memory', () => {
    const bus = new TestMemoryBus();
    const { start, bytes } = buildProgram8();
    setReset(bus, start);

    // Place program at $00:8000
    for (let i = 0; i < bytes.length; i++) bus.write8((0x00 << 16) | (start + i), bytes[i]);

    const cpu = new CPU65C816(bus);
    cpu.reset();

    // After reset, E=1, M=1 => 8-bit accumulator semantics

    // 1) LDA #$12
    cpu.stepInstruction();
    expect(cpu.state.A & 0xff).toBe(0x12);
    expect((cpu.state.P & Flag.Z) !== 0).toBe(false);
    expect((cpu.state.P & Flag.N) !== 0).toBe(false);

    // 2) STA $10
    cpu.stepInstruction();
    expect(bus.read8(0x000010)).toBe(0x12);

    // 3) LDA $10
    cpu.stepInstruction();
    expect(cpu.state.A & 0xff).toBe(0x12);

    // 4) ADC $10 (C=0 by default after reset)
    cpu.stepInstruction();
    expect(cpu.state.A & 0xff).toBe(0x24);
    expect((cpu.state.P & Flag.C) !== 0).toBe(false);

    // 5) DEC $10
    cpu.stepInstruction();
    expect(bus.read8(0x000010)).toBe(0x11);
    // DEC should set Z/N from memory result, A unchanged
    expect(cpu.state.A & 0xff).toBe(0x24);
    expect((cpu.state.P & Flag.Z) !== 0).toBe(false);
    expect((cpu.state.P & Flag.N) !== 0).toBe(false);
  });
});

