import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Verify that the P flag in PSW selects DP base ($0000 vs $0100) for direct page accesses
// using only MOV A,dp (E4) and MOV dp,A (C5) which are already implemented in the SMP core.

describe('SMP direct page remap via PSW.P (CLRP/SETP semantics)', () => {
  it('reads dp from $00xx when P=0 and from $01xx when P=1', () => {
    const apu: any = new APUDevice();

    // Seed two different locations at $0012 and $0112
    apu.aram[0x0012] = 0x11;
    apu.aram[0x0112] = 0x22;

    // Program at $0200: mov a,$12
    apu.aram[0x0200] = 0xE4;
    apu.aram[0x0201] = 0x12;

    // Case 1: P=0 -> base $0000
    apu.smp.PSW = 0x00;
    apu.smp.PC = 0x0200;
    apu.step(16);
    expect(apu.smp.A & 0xff).toBe(0x11);

    // Case 2: P=1 -> base $0100
    apu.smp.PSW = (apu.smp.PSW | 0x20) & 0xff; // set P bit
    apu.smp.PC = 0x0200;
    apu.step(16);
    expect(apu.smp.A & 0xff).toBe(0x22);
  });

  it('writes dp to $00xx when P=0 and to $01xx when P=1', () => {
    const apu: any = new APUDevice();

    // Program: mov a,#$5A; mov $34,a
    apu.aram[0x0200] = 0xE8; // MOV A,#imm
    apu.aram[0x0201] = 0x5A;
    apu.aram[0x0202] = 0xC5; // MOV dp,A
    apu.aram[0x0203] = 0x34;

    // Case 1: P=0 -> write to $0034
    apu.smp.PSW = 0x00;
    apu.smp.PC = 0x0200;
    apu.step(32);
    expect(apu.aram[0x0034] & 0xff).toBe(0x5A);
    expect(apu.aram[0x0134] & 0xff).toBe(0x00);

    // Reset memory at $0034 and re-run with P=1
    apu.aram[0x0034] = 0x00;

    // Case 2: P=1 -> write to $0134
    apu.smp.PSW = 0x20; // P=1
    apu.smp.PC = 0x0200;
    apu.step(32);
    expect(apu.aram[0x0034] & 0xff).toBe(0x00);
    expect(apu.aram[0x0134] & 0xff).toBe(0x5A);
  });
});
