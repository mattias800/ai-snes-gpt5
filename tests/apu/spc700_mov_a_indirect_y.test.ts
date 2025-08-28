import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Tests for MOV A,[$dp]+Y addressing form (0xF7)

describe('SMP MOV A,[$dp]+Y', () => {
  it('loads via DP pointer at dp then +Y, updates Z/N', () => {
    const apu: any = new APUDevice();
    const pc = 0x1500;

    // Use P=0 (DP at $00xx), Y=3
    apu.smp.PSW = 0x00;
    apu.smp.Y = 0x03;

    // dp operand = $20; pointer at $0020/$0021 -> $4100
    apu.aram[0x0020] = 0x00;
    apu.aram[0x0021] = 0x41;

    // Value at pointer+Y = $4103
    apu.aram[0x4103] = 0x00; // will set Z

    // Program: MOV A,[$20]+Y
    apu.aram[pc + 0] = 0xF7; apu.aram[pc + 1] = 0x20;

    apu.smp.PC = pc;
    apu.step(24);

    expect(apu.smp.A & 0xff).toBe(0x00);
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(1); // Z=1
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0); // N=0
  });
});

