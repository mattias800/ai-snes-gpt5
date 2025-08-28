import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Validate PSW control ops: CLRC/SETC, CLRP/SETP, EI/DI and their effects.
// Opcodes under test (SPC700):
//  - CLRC: 0x60, SETC: 0x80
//  - CLRP: 0x20, SETP: 0x40
//  - EI:   0xA0, DI:   0xC0
//  - MOV A,#imm: 0xE8; MOV A,dp: 0xE4

describe('SMP PSW control instructions', () => {
  it('CLRC/SETC toggles carry bit', () => {
    const apu: any = new APUDevice();
    const pc = 0x0600;
    // Program: SETC; CLRC; SETC
    apu.aram[pc + 0] = 0x80; // SETC
    apu.aram[pc + 1] = 0x60; // CLRC
    apu.aram[pc + 2] = 0x80; // SETC
    apu.smp.PC = pc;
    apu.step(32);
    expect(apu.smp.PSW & 0x01).toBe(0x01); // C=1
  });

  it('CLRP/SETP toggles direct page P and affects DP base for MOV A,dp', () => {
    const apu: any = new APUDevice();
    // Seed distinct bytes at $0012 and $0112
    apu.aram[0x0012] = 0x11;
    apu.aram[0x0112] = 0x22;

    const pc = 0x0620;
    // Program:
    //   CLRP         (20)
    //   MOV A,$12    (E4 12) -> 0x11
    //   SETP         (40)
    //   MOV A,$12    (E4 12) -> 0x22
    apu.aram[pc + 0] = 0x20; // CLRP
    apu.aram[pc + 1] = 0xE4; // MOV A,dp
    apu.aram[pc + 2] = 0x12;
    apu.aram[pc + 3] = 0x40; // SETP
    apu.aram[pc + 4] = 0xE4; // MOV A,dp
    apu.aram[pc + 5] = 0x12;

    apu.smp.PC = pc;
    apu.smp.PSW = apu.smp.PSW | 0x02; // set Z to observe changes later (not required)
    apu.step(64);

    // After final MOV with P=1, A should be 0x22
    expect(apu.smp.A & 0xff).toBe(0x22);
    // Ensure P flag is set
    expect(apu.smp.PSW & 0x20).toBe(0x20);
  });

  it('EI/DI toggle interrupt enable flag (I)', () => {
    const apu: any = new APUDevice();
    const pc = 0x0640;
    apu.aram[pc + 0] = 0xA0; // EI
    apu.aram[pc + 1] = 0xC0; // DI
    apu.aram[pc + 2] = 0xA0; // EI

    apu.smp.PC = pc;
    apu.step(48);

    expect(apu.smp.PSW & 0x04).toBe(0x04); // I=1
  });
});
