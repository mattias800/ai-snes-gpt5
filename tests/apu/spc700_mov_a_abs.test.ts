import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Tests for MOV A,abs and MOV abs,A

describe('SMP MOV A <-> absolute', () => {
  it('MOV A,$abs loads and updates Z/N; MOV $abs,A stores and preserves PSW', () => {
    const apu: any = new APUDevice();
    const pc = 0x1260;

    apu.aram[0x4567] = 0x80;
    apu.smp.PSW = 0x85; // pattern with P=0

    // MOV A,$4567; MOV $4568,A
    apu.aram[pc + 0] = 0xE5; apu.aram[pc + 1] = 0x67; apu.aram[pc + 2] = 0x45;
    apu.aram[pc + 3] = 0xC4; apu.aram[pc + 4] = 0x68; apu.aram[pc + 5] = 0x45;

    apu.smp.PC = pc;
    apu.step(48);

    expect(apu.smp.A & 0xff).toBe(0x80);
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1); // N=1 after load
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0); // Z=0
    expect(apu.aram[0x4568] & 0xff).toBe(0x80); // store
  });
});

