import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Tests for MUL YA (0xCF) and DIV YA,X (0x9E)
// Hardware rules:
// - MUL YA: 16-bit product in YA; N/Z from Y; V/C/H unaffected.
// - DIV YA,X: A=quotient, Y=remainder; Z/N from A; V=1 when true quotient > 8 bits; H=(A>=X); C preserved.

describe('SMP MUL/DIV behavior and flags', () => {
  it('MUL YA multiplies unsigned 8-bit values into YA and sets Z/N from high byte (Y)', () => {
    const apu: any = new APUDevice();
    const pc = 0x1500;

    apu.smp.Y = 0x03; apu.smp.A = 0x04; // 3 * 4 = 12 -> YA=0x000C
    apu.aram[pc + 0] = 0xCF; // MUL YA

    apu.smp.PC = pc;
    apu.step(32);

    expect(((apu.smp.Y << 8) | apu.smp.A) & 0xffff).toBe(0x000C);
    // Z/N from Y=0x00 -> Z=1, N=0
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(1);
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0);
  });

  it('MUL YA sets N when bit15 of product is 1', () => {
    const apu: any = new APUDevice();
    const pc = 0x1520;

    apu.smp.Y = 0xFF; apu.smp.A = 0xFF; // 0xFF * 0xFF = 0xFE01 -> bit15=1
    apu.aram[pc + 0] = 0xCF; // MUL YA

    apu.smp.PC = pc;
    apu.step(32);

    expect(((apu.smp.Y << 8) | apu.smp.A) & 0xffff).toBe(0xFE01);
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1); // N=1
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0); // Z=0
  });

  it('DIV YA,X: normal division places quotient in A and remainder in Y; ZN from A; H=(A>=X), C preserved', () => {
    const apu: any = new APUDevice();
    const pc = 0x1540;

    // YA = 0x0103 (259); X=2 -> Q=129 (0x81), R=1
    apu.smp.Y = 0x01; apu.smp.A = 0x03; apu.smp.X = 0x02;
    apu.smp.PSW = 0xFF; // start with all bits set to see clears

    apu.aram[pc + 0] = 0x9E; // DIV YA,X

    apu.smp.PC = pc;
    apu.step(48);

    expect(apu.smp.A & 0xff).toBe(0x81); // quotient
    expect(apu.smp.Y & 0xff).toBe(0x01); // remainder
    // Z/N based on A=0x81 -> N=1, Z=0
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1);
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0);
    // V should be 0 here
    expect((apu.smp.PSW & 0x40) >>> 6).toBe(0);
    // H set iff initial A >= X; C preserved (initial C was 1)
    expect((apu.smp.PSW & 0x08) >>> 3).toBe(1);
    expect(apu.smp.PSW & 0x01).toBe(0x01);
  });

  it('DIV YA,X sets V when quotient would exceed 8 bits (overflow)', () => {
    const apu: any = new APUDevice();
    const pc = 0x1560;

    apu.smp.Y = 0xFF; apu.smp.A = 0xFF; apu.smp.X = 0x01;
    apu.smp.PSW = 0x00;
    apu.aram[pc + 0] = 0x9E; // DIV

    apu.smp.PC = pc;
    apu.step(48);

    // Hardware sets V when the (true) quotient exceeds 8 bits; we only assert V here
    expect((apu.smp.PSW & 0x40) >>> 6).toBe(1); // V=1
  });

  it('DIV by zero: A becomes ~Y, Y unchanged, V=1, H=(A>=X), C preserved', () => {
    const apu: any = new APUDevice();
    const pc = 0x1580;

    apu.smp.Y = 0x12; apu.smp.A = 0x34; apu.smp.X = 0x00;
    apu.smp.PSW = 0x09; // H|C set to verify they get cleared
    apu.aram[pc + 0] = 0x9E; // DIV YA,X

    apu.smp.PC = pc;
    apu.step(48);

    expect(apu.smp.A & 0xff).toBe(0xED); // ~Y
    expect(apu.smp.Y & 0xff).toBe(0x12); // unchanged
    expect((apu.smp.PSW & 0x40) >>> 6).toBe(1); // V=1
    // H=(A>=X) with X=0 always true; C preserved (initial C was 1)
    expect((apu.smp.PSW & 0x08) >>> 3).toBe(1);
    expect(apu.smp.PSW & 0x01).toBe(0x01);
  });
});

