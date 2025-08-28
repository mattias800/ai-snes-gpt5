import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Ensure PSW.P=1 switches DP base for both dp+X and [$dp+X] indirection.

describe('SMP direct page P=1 with indexed and indirect indexed addressing', () => {
  it('MOV A,$dp+X uses DP=$01xx when P=1', () => {
    const apu: any = new APUDevice();
    const pc = 0x1780;

    apu.smp.PSW = 0x20; // P=1
    apu.smp.X = 0x03;
    // Effective address: $01(20+3) = $0123
    apu.aram[0x0123] = 0x5A;

    apu.aram[pc + 0] = 0xF4; apu.aram[pc + 1] = 0x20; // MOV A,$20+X

    apu.smp.PC = pc;
    apu.step(16);

    expect(apu.smp.A & 0xff).toBe(0x5A);
  });

  it('MOV A,[$dp+X] fetches pointer from $01xx when P=1', () => {
    const apu: any = new APUDevice();
    const pc = 0x17A0;

    apu.smp.PSW = 0x20; // P=1
    apu.smp.X = 0x02;

    // dp operand = $30 -> pointer at $0132/$0133 -> $5200
    apu.aram[0x0132] = 0x00; // lo
    apu.aram[0x0133] = 0x52; // hi
    apu.aram[0x5200] = 0x77;

    apu.aram[pc + 0] = 0xE7; apu.aram[pc + 1] = 0x30; // MOV A,[$30+X]

    apu.smp.PC = pc;
    apu.step(24);

    expect(apu.smp.A & 0xff).toBe(0x77);
  });
});

