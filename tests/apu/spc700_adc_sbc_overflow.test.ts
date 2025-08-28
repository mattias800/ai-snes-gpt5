import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Overflow-specific tests for ADC and SBC

describe('SMP ADC/SBC overflow flag behavior', () => {
  it('ADC A,(X) sets V on 0x7F + 0x01 -> 0x80 (signed overflow), N=1, Z=0', () => {
    const apu: any = new APUDevice();
    const pc = 0x17C0;

    apu.smp.A = 0x7F;
    apu.smp.X = 0x10;
    apu.aram[0x0010] = 0x01; // operand at DP+X
    apu.smp.PSW = 0x00; // C=0

    apu.aram[pc + 0] = 0x86; // ADC A,(X)

    apu.smp.PC = pc;
    apu.step(16);

    expect(apu.smp.A & 0xff).toBe(0x80);
    expect((apu.smp.PSW & 0x40) >>> 6).toBe(1); // V=1
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1); // N=1
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0); // Z=0
  });

  it('SBC A,#imm sets V when sign overflow occurs: 0x80 - 0x01 -> 0x7F, V=1', () => {
    const apu: any = new APUDevice();
    const pc = 0x17E0;

    apu.smp.A = 0x80;
    apu.smp.PSW = 0x01; // C=1 (no extra borrow)

    apu.aram[pc + 0] = 0xA8; apu.aram[pc + 1] = 0x01; // SBC A,#$01

    apu.smp.PC = pc;
    apu.step(16);

    expect(apu.smp.A & 0xff).toBe(0x7F);
    expect((apu.smp.PSW & 0x40) >>> 6).toBe(1); // V=1
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0); // N=0
    expect((apu.smp.PSW & 0x01) >>> 0).toBe(1); // C=1 (no borrow)
  });
});

