import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Test MOV X/#, MOV Y/# and A<->X/Y transfers with flag behavior

describe('SMP register transfers X/Y and immediates', () => {
  it('MOV X,#imm and MOV Y,#imm set registers and update Z/N', () => {
    const apu: any = new APUDevice();
    const pc = 0x0DA0;

    // Set PSW C/V/H to confirm they remain unchanged
    apu.smp.PSW |= 0x01 | 0x40 | 0x08;

    // Program: MOV X,#$00; MOV Y,#$80
    apu.aram[pc + 0] = 0xCD; apu.aram[pc + 1] = 0x00; // X <- 0x00 (Z=1)
    apu.aram[pc + 2] = 0x8D; apu.aram[pc + 3] = 0x80; // Y <- 0x80 (N=1)

    apu.smp.PC = pc;
    apu.step(16);

    expect(apu.smp.X & 0xff).toBe(0x00);
    expect(apu.smp.Y & 0xff).toBe(0x80);
    // Flags after last op reflect Y (N=1, Z=0)
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1);
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0);
    // C,V,H preserved
    expect((apu.smp.PSW & 0x01) >>> 0).toBe(1);
    expect((apu.smp.PSW & 0x40) >>> 6).toBe(1);
    expect((apu.smp.PSW & 0x08) >>> 3).toBe(1);
  });

  it('MOV A,X and MOV X,A transfer with Z/N according to destination', () => {
    const apu: any = new APUDevice();
    const pc = 0x0DC0;

    // X=0x7f -> A=0x7f (N=0, Z=0), then A=0x00 -> X=0x00 (Z=1)
    apu.smp.X = 0x7f; apu.smp.A = 0x00;

    apu.aram[pc + 0] = 0x5D; // A <- X
    apu.aram[pc + 1] = 0xE8; apu.aram[pc + 2] = 0x00; // A <- #$00
    apu.aram[pc + 3] = 0x7D; // X <- A

    apu.smp.PC = pc;
    apu.step(32);

    expect(apu.smp.A & 0xff).toBe(0x00);
    expect(apu.smp.X & 0xff).toBe(0x00);
    // After last op (X <- A=0x00): Z=1, N=0
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(1);
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0);
  });

  it('MOV A,Y and MOV Y,A transfer with Z/N according to destination', () => {
    const apu: any = new APUDevice();
    const pc = 0x0DE0;

    apu.smp.Y = 0x80; apu.smp.A = 0x01;

    apu.aram[pc + 0] = 0xDD; // A <- Y (A=0x80)
    apu.aram[pc + 1] = 0xFD; // Y <- A (Y=0x80)

    apu.smp.PC = pc;
    apu.step(16);

    expect(apu.smp.A & 0xff).toBe(0x80);
    expect(apu.smp.Y & 0xff).toBe(0x80);
    // After last op (Y <- A=0x80): N=1, Z=0
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1);
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0);
  });
});

