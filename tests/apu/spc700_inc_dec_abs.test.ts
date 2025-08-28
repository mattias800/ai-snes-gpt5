import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Tests for INC/DEC absolute addressing

describe('SMP INC/DEC absolute', () => {
  it('INC $abs wraps and sets Z', () => {
    const apu: any = new APUDevice();
    const pc = 0x1200;

    apu.aram[0x3456] = 0xFF; // -> 0x00

    // INC $3456 (0xAC 56 34)
    apu.aram[pc + 0] = 0xAC; apu.aram[pc + 1] = 0x56; apu.aram[pc + 2] = 0x34;

    apu.smp.PC = pc;
    apu.step(16);

    expect(apu.aram[0x3456] & 0xff).toBe(0x00);
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(1); // Z=1
  });

  it('DEC $abs wraps and sets N', () => {
    const apu: any = new APUDevice();
    const pc = 0x1220;

    apu.aram[0x3456] = 0x00; // -> 0xFF

    // DEC $3456 (0x8C 56 34)
    apu.aram[pc + 0] = 0x8C; apu.aram[pc + 1] = 0x56; apu.aram[pc + 2] = 0x34;

    apu.smp.PC = pc;
    apu.step(16);

    expect(apu.aram[0x3456] & 0xff).toBe(0xFF);
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1); // N=1
  });
});

