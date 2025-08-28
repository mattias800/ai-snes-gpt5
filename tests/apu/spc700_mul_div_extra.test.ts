import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Additional MUL/DIV edge cases aligned with SPC700 hardware behavior
// Hardware rules summarized:
// - MUL YA (0xCF):
//   - Result is 16-bit in YA (Y=high, A=low).
//   - N/Z are derived from the high byte (Y). V/C/H are unaffected.
// - DIV YA,X (0x9E):
//   - Computes quotient = floor((YA)/X) -> stored in A, remainder in Y.
//   - Z/N are from A (the quotient). V is set when (true) quotient exceeds 8 bits (hardware overflow case),
//     otherwise cleared. H is set iff initial A >= X. C is preserved.
//   - Division by zero: A becomes ~Y, Y unchanged, V=1, H=(A>=X), C preserved.

describe('SMP MUL/DIV hardware-aligned edge cases', () => {
  it('DIV: YA < X with A < X -> Q=0, R=YA, Z=1, N=0, V=0, H=0, C preserved (0)', () => {
    const apu: any = new APUDevice();
    const pc = 0x15A0;

    // YA = 0x000A; X = 0x0B; A(0x0A) < X(0x0B) so H=0
    apu.smp.Y = 0x00; apu.smp.A = 0x0A; apu.smp.X = 0x0B;
    apu.smp.PSW = 0x00; // C=0 initially
    apu.aram[pc + 0] = 0x9E; // DIV YA,X

    apu.smp.PC = pc;
    apu.step(48);

    expect(apu.smp.A & 0xff).toBe(0x00); // quotient
    expect(apu.smp.Y & 0xff).toBe(0x0A); // remainder
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(1); // Z=1
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0); // N=0
    expect((apu.smp.PSW & 0x40) >>> 6).toBe(0); // V=0
    expect((apu.smp.PSW & 0x08) >>> 3).toBe(0); // H=0
    expect(apu.smp.PSW & 0x01).toBe(0x00);      // C preserved
  });

  it('DIV: overflow case with Y>=X but Y < 2*X (no extra adjustment) -> V=1, H=(A>=X), C preserved', () => {
    const apu: any = new APUDevice();
    const pc = 0x15C0;

    // YA = 0x0203 (515); X = 0x02 -> Q=257 (>255), R=1
    apu.smp.Y = 0x02; apu.smp.A = 0x03; apu.smp.X = 0x02;
    apu.smp.PSW = 0x01; // C=1 to verify preservation
    apu.aram[pc + 0] = 0x9E; // DIV

    apu.smp.PC = pc;
    apu.step(48);

    // H since A(3) >= X(2)
    expect((apu.smp.PSW & 0x08) >>> 3).toBe(1);
    // V set due to 9-bit quotient
    expect((apu.smp.PSW & 0x40) >>> 6).toBe(1);
    // C preserved
    expect(apu.smp.PSW & 0x01).toBe(0x01);

    // In this specific case (Y < 2*X), hardware-compatible core yields A=0x01, Y=0x01
    expect(apu.smp.A & 0xff).toBe(0x01);
    expect(apu.smp.Y & 0xff).toBe(0x01);
    // Z/N from A
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0);
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0);
  });

  it('MUL preserves V/C/H and sets Z/N from high byte (Y)', () => {
    const apu: any = new APUDevice();
    const pc = 0x15E0;

    apu.smp.Y = 0x02; apu.smp.A = 0x02; // product 0x0004 -> Y=0x00
    apu.smp.PSW = 0x49; // V|C|H preset
    apu.aram[pc + 0] = 0xCF; // MUL

    apu.smp.PC = pc;
    apu.step(32);

    // Z from Y==0 -> 1, N=0
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(1);
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0);
    // V/C/H preserved
    expect((apu.smp.PSW & 0x40) >>> 6).toBe(1);
    expect((apu.smp.PSW & 0x08) >>> 3).toBe(1);
    expect((apu.smp.PSW & 0x01) >>> 0).toBe(1);
  });
});

