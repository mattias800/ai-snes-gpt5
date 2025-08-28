import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

describe('SMP MOV A indexed/indirect addressing modes', () => {
  it('MOV A,(X) loads from DP+X and updates Z/N', () => {
    const apu: any = new APUDevice();
    const pc = 0x1400;

    apu.smp.PSW = 0x00; // P=0
    apu.smp.X = 0x10;

    // Value at DP+X
    apu.aram[0x0010] = 0x80;

    // Program: MOV A,(X)
    apu.aram[pc + 0] = 0xE6;

    apu.smp.PC = pc;
    apu.step(8);

    expect(apu.smp.A & 0xff).toBe(0x80);
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1); // N=1
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0); // Z=0
  });

  it('MOV (X),A stores to DP+X and preserves PSW', () => {
    const apu: any = new APUDevice();
    const pc = 0x1420;

    apu.smp.PSW = 0x5A; // verify preserved
    apu.smp.X = 0x20;
    apu.smp.A = 0xCC;

    // Program: MOV (X),A
    apu.aram[pc + 0] = 0xC6;

    apu.smp.PC = pc;
    apu.step(8);

    expect(apu.aram[0x0020] & 0xff).toBe(0xCC);
    expect(apu.smp.PSW & 0xff).toBe(0x5A); // unchanged
  });

  it('MOV A,(X) respects PSW.P (DP=$0100) for DP selection', () => {
    const apu: any = new APUDevice();
    const pc = 0x1480;

    // Set P=1 to use $01xx for DP
    apu.smp.PSW = 0x20;
    apu.smp.X = 0x12;

    // Value at $0112
    apu.aram[0x0112] = 0x44;

    // Program: MOV A,(X)
    apu.aram[pc + 0] = 0xE6;

    apu.smp.PC = pc;
    apu.step(8);

    expect(apu.smp.A & 0xff).toBe(0x44);
  });

  it('MOV A,[$dp+X] loads via DP pointer at dp+X and updates Z/N', () => {
    const apu: any = new APUDevice();
    const pc = 0x14A0;

    apu.smp.PSW = 0x00; // P=0
    apu.smp.X = 0x03;

    // Base dp operand = $20; pointer at $0023/$0024 -> $4100
    apu.aram[0x0023] = 0x00;
    apu.aram[0x0024] = 0x41;
    apu.aram[0x4100] = 0x7F;

    // Program: MOV A,[$20+X]
    apu.aram[pc + 0] = 0xE7; apu.aram[pc + 1] = 0x20;

    apu.smp.PC = pc;
    apu.step(24);

    expect(apu.smp.A & 0xff).toBe(0x7F);
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0); // Z=0
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0); // N=0
  });

  it('MOV [$dp+X],A stores via DP pointer at dp+X and preserves PSW', () => {
    const apu: any = new APUDevice();
    const pc = 0x14C0;

    apu.smp.PSW = 0x85; // preserve (P=0)
    apu.smp.X = 0x01;
    apu.smp.A = 0x99;

    // dp operand = $30; pointer at $0031/$0032 -> $6200
    apu.aram[0x0031] = 0x00;
    apu.aram[0x0032] = 0x62;

    // Program: MOV [$30+X],A
    apu.aram[pc + 0] = 0xC7; apu.aram[pc + 1] = 0x30;

    apu.smp.PC = pc;
    apu.step(24);

    expect(apu.aram[0x6200] & 0xff).toBe(0x99);
    expect(apu.smp.PSW & 0xff).toBe(0x85);
  });
});

