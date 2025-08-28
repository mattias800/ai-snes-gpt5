import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Smoke tests asserting cycle counts for representative SPC700 instructions

describe('SPC700 cycle counts (smoke)', () => {
  it('MOV A,#imm = 2 cycles', () => {
    const apu: any = new APUDevice();
    const pc = 0x2000;
    apu.aram[pc + 0] = 0xE8; apu.aram[pc + 1] = 0x5A;
    apu.smp.PC = pc;
    apu.step(2);
    expect(apu.smp.A & 0xff).toBe(0x5A);
    expect(apu.smp.lastCycles | 0).toBe(2);
  });

  it('MOV A,dp = 3 and MOV dp,A = 3', () => {
    const apu: any = new APUDevice();
    const pc = 0x2020;
    apu.smp.PSW = 0x00; // P=0 -> DP=$00
    apu.aram[0x0034] = 0x12;
    // MOV A,$34
    apu.aram[pc + 0] = 0xE4; apu.aram[pc + 1] = 0x34;
    apu.smp.PC = pc;
    apu.step(3);
    expect(apu.smp.A & 0xff).toBe(0x12);
    expect(apu.smp.lastCycles | 0).toBe(3);
    // MOV $35,A
    apu.aram[pc + 2] = 0xC5; apu.aram[pc + 3] = 0x35;
    apu.smp.PC = pc + 2;
    apu.step(3);
    expect(apu.aram[0x0035] & 0xff).toBe(0x12);
    expect(apu.smp.lastCycles | 0).toBe(3);
  });

  it('MOV A,abs = 4 and MOV abs,A = 5', () => {
    const apu: any = new APUDevice();
    const pc = 0x2040;
    apu.aram[0x3456] = 0x9C;
    // MOV A,$3456
    apu.aram[pc + 0] = 0xE5; apu.aram[pc + 1] = 0x56; apu.aram[pc + 2] = 0x34;
    apu.smp.PC = pc;
    apu.step(4);
    expect(apu.smp.A & 0xff).toBe(0x9C);
    expect(apu.smp.lastCycles | 0).toBe(4);
    // MOV $3457,A
    apu.aram[pc + 3] = 0xC4; apu.aram[pc + 4] = 0x57; apu.aram[pc + 5] = 0x34;
    apu.smp.PC = pc + 3;
    apu.step(5);
    expect(apu.aram[0x3457] & 0xff).toBe(0x9C);
    expect(apu.smp.lastCycles | 0).toBe(5);
  });

  it('MOV A,dp+X = 4 and MOV dp+X,A = 4', () => {
    const apu: any = new APUDevice();
    const pc = 0x2060;
    apu.smp.PSW = 0x00; apu.smp.X = 0x02;
    apu.aram[0x0042] = 0x77; // $40+X
    // MOV A,$40+X
    apu.aram[pc + 0] = 0xF4; apu.aram[pc + 1] = 0x40;
    apu.smp.PC = pc;
    apu.step(4);
    expect(apu.smp.A & 0xff).toBe(0x77);
    expect(apu.smp.lastCycles | 0).toBe(4);
    // MOV $41+X,A -> $43
    apu.aram[pc + 2] = 0xD5; apu.aram[pc + 3] = 0x41;
    apu.smp.PC = pc + 2;
    apu.step(4);
    expect(apu.aram[0x0043] & 0xff).toBe(0x77);
    expect(apu.smp.lastCycles | 0).toBe(4);
  });

  it('MOV A,(X) = 4 and MOV (X),A = 4', () => {
    const apu: any = new APUDevice();
    const pc = 0x2080;
    apu.smp.PSW = 0x00; apu.smp.X = 0x10;
    apu.aram[0x0010] = 0xA5;
    // MOV A,(X)
    apu.aram[pc + 0] = 0xE6;
    apu.smp.PC = pc;
    apu.step(4);
    expect(apu.smp.A & 0xff).toBe(0xA5);
    expect(apu.smp.lastCycles | 0).toBe(4);
    // MOV (X),A
    apu.aram[pc + 1] = 0xC6; apu.smp.A = 0x5A;
    apu.smp.PC = pc + 1;
    apu.step(4);
    expect(apu.aram[0x0010] & 0xff).toBe(0x5A);
    expect(apu.smp.lastCycles | 0).toBe(4);
  });

  it('MOV A,[$dp+X] = 6 and MOV [$dp+X],A = 7', () => {
    const apu: any = new APUDevice();
    const pc = 0x20A0;
    apu.smp.PSW = 0x00; apu.smp.X = 0x03;
    // dp operand $20 -> pointer at $0023/$0024 -> $4100
    apu.aram[0x0023] = 0x00; apu.aram[0x0024] = 0x41; apu.aram[0x4100] = 0x55;
    // MOV A,[$20+X]
    apu.aram[pc + 0] = 0xE7; apu.aram[pc + 1] = 0x20;
    apu.smp.PC = pc;
    apu.step(6);
    expect(apu.smp.A & 0xff).toBe(0x55);
    expect(apu.smp.lastCycles | 0).toBe(6);
    // MOV [$20+X],A
    apu.aram[pc + 2] = 0xC7; apu.aram[pc + 3] = 0x20; apu.smp.A = 0x66;
    apu.smp.PC = pc + 2;
    apu.step(7);
    expect(apu.aram[0x4100] & 0xff).toBe(0x66);
    expect(apu.smp.lastCycles | 0).toBe(7);
  });


  it('MOV Y,abs = 4 and MOV abs,Y = 5', () => {
    const apu: any = new APUDevice();
    const pc = 0x20E0;
    apu.aram[0x2233] = 0x7E;
    // MOV Y,$2233
    apu.aram[pc + 0] = 0xEC; apu.aram[pc + 1] = 0x33; apu.aram[pc + 2] = 0x22;
    apu.smp.PC = pc;
    apu.step(4);
    expect(apu.smp.Y & 0xff).toBe(0x7E);
    expect(apu.smp.lastCycles | 0).toBe(4);
    // MOV $2234,Y
    apu.aram[pc + 3] = 0xCC; apu.aram[pc + 4] = 0x34; apu.aram[pc + 5] = 0x22;
    apu.smp.PC = pc + 3;
    apu.step(5);
    expect(apu.aram[0x2234] & 0xff).toBe(0x7E);
    expect(apu.smp.lastCycles | 0).toBe(5);
  });

  it('INC dp = 4 and DEC abs = 5', () => {
    const apu: any = new APUDevice();
    const pc = 0x2100;
    apu.smp.PSW = 0x00; apu.aram[0x0050] = 0x01; apu.aram[0x3300] = 0x10;
    // INC $50
    apu.aram[pc + 0] = 0xAB; apu.aram[pc + 1] = 0x50;
    apu.smp.PC = pc;
    apu.step(4);
    expect(apu.aram[0x0050] & 0xff).toBe(0x02);
    expect(apu.smp.lastCycles | 0).toBe(4);
    // DEC $3300
    apu.aram[pc + 2] = 0x8C; apu.aram[pc + 3] = 0x00; apu.aram[pc + 4] = 0x33;
    apu.smp.PC = pc + 2;
    apu.step(5);
    expect(apu.aram[0x3300] & 0xff).toBe(0x0F);
    expect(apu.smp.lastCycles | 0).toBe(5);
  });

  it('ADC A,#imm = 2, AND A,dp = 3, EOR A,dp = 3, XCN = 5', () => {
    const apu: any = new APUDevice();
    const pc = 0x2120;
    // ADC A,#$10 (A starts 0)
    apu.aram[pc + 0] = 0x88; apu.aram[pc + 1] = 0x10;
    apu.smp.PC = pc;
    apu.step(2);
    expect(apu.smp.A & 0xff).toBe(0x10);
    expect(apu.smp.lastCycles | 0).toBe(2);
    // AND A,$40
    apu.smp.PSW = 0x00; apu.aram[0x0040] = 0x0F;
    apu.aram[pc + 2] = 0x24; apu.aram[pc + 3] = 0x40;
    apu.smp.PC = pc + 2;
    apu.step(3);
    expect(apu.smp.A & 0xff).toBe(0x00);
    expect(apu.smp.lastCycles | 0).toBe(3);
    // EOR A,$41
    apu.aram[0x0041] = 0xAA; apu.aram[pc + 4] = 0x44; apu.aram[pc + 5] = 0x41;
    apu.smp.PC = pc + 4;
    apu.step(3);
    expect(apu.smp.A & 0xff).toBe(0xAA);
    expect(apu.smp.lastCycles | 0).toBe(3);
    // XCN
    apu.aram[pc + 6] = 0x9F;
    apu.smp.PC = pc + 6;
    apu.step(5);
    expect(apu.smp.lastCycles | 0).toBe(5);
  });
});

