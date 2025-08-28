import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// These tests poke raw opcodes into ARAM to validate SMP flag semantics for
// logical operations and compares. Hardware note: logical ops (OR/AND/EOR) update N/Z and preserve V and C.
// Opcodes used (SPC700):
//  - OR A,#imm: 0x08
//  - OR A,dp  : 0x04
//  - AND A,#imm: 0x28
//  - AND A,dp  : 0x24
//  - EOR A,#imm: 0x48
//  - EOR A,dp  : 0x44
//  - CMP A,#imm: 0x68
//  - CMP A,dp  : 0x64
//  - MOV A,#imm: 0xE8 (for setup)

describe('SMP flags: logical ops and CMP', () => {
  it('AND/OR/EOR: update N/Z, preserve V and C', () => {
    const apu: any = new APUDevice();

    // Seed DP value at $10 for OR/EOR dp tests
    apu.aram[0x0010] = 0x80;

    // Program:
    //   mov a,#$f0      (e8 f0)
    //   and a,#$0f      (28 0f) -> a = 0x00, Z=1, N=0, V=0, C preserved
    //   or  a,$10       (04 10) -> a = 0x80, Z=0, N=1, V=0
    //   eor a,#$ff      (48 ff) -> a = 0x7f, Z=0, N=0, V=0
    const pc = 0x0200;
    const prog = [0xE8, 0xF0, 0x28, 0x0F, 0x04, 0x10, 0x48, 0xFF];
    for (let i = 0; i < prog.length; i++) apu.aram[pc + i] = prog[i];

    // Set PSW C=1 and V=1 to check preservation/clearing
    apu.smp.PSW = (apu.smp.PSW | 0x01 | 0x40) & 0xff;
    apu.smp.PC = pc;

    apu.step(64);

    // After AND: Z=1, N=0, V preserved; C preserved (was 1).
    // After the full sequence: final A=0x7f, N=0, Z=0, V=1, C=1
    expect(apu.smp.A & 0xff).toBe(0x7f);
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0); // N=0
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0); // Z=0
    expect((apu.smp.PSW & 0x40) >>> 6).toBe(1); // V preserved by logical ops
    expect(apu.smp.PSW & 0x01).toBe(0x01);      // C preserved as 1
  });

  it('CMP A,#imm sets Z/N and C=1 when A >= imm (unsigned)', () => {
    const apu: any = new APUDevice();

    // Case 1: A < imm
    let pc = 0x0300;
    apu.aram[pc + 0] = 0xE8; // mov a,#$10
    apu.aram[pc + 1] = 0x10;
    apu.aram[pc + 2] = 0x68; // cmp a,#$20
    apu.aram[pc + 3] = 0x20;
    apu.smp.PC = pc;
    apu.step(32);
    expect((apu.smp.PSW & 0x01) >>> 0).toBe(0); // C=0
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0); // Z=0
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1); // N=1 (0x10-0x20 = 0xF0)

    // Case 2: A == imm
    pc = 0x0320;
    apu.aram[pc + 0] = 0xE8; // mov a,#$20
    apu.aram[pc + 1] = 0x20;
    apu.aram[pc + 2] = 0x68; // cmp a,#$20
    apu.aram[pc + 3] = 0x20;
    apu.smp.PC = pc;
    apu.step(32);
    expect(apu.smp.PSW & 0x01).toBe(0x01); // C=1
    expect(apu.smp.PSW & 0x02).toBe(0x02); // Z=1
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0); // N=0
  });

  it('CMP A,dp (unsigned) sets C correctly', () => {
    const apu: any = new APUDevice();

    // mem[$11] = 0x02
    apu.aram[0x0011] = 0x02;

    // mov a,#$03; cmp a,$11
    const pc = 0x0340;
    apu.aram[pc + 0] = 0xE8; // mov a,#imm
    apu.aram[pc + 1] = 0x03;
    apu.aram[pc + 2] = 0x64; // cmp a,dp
    apu.aram[pc + 3] = 0x11;

    apu.smp.PC = pc;
    apu.step(32);

    expect(apu.smp.PSW & 0x01).toBe(0x01); // C=1 since 3 >= 2
    expect(apu.smp.PSW & 0x02).toBe(0x00); // Z=0
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0); // N=0 (0x01)
  });
});
