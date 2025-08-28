import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Tests for INC/DEC on X/Y and on direct page (dp and dp+X)

describe('SMP INC/DEC X/Y and DP/DP+X', () => {
  it('INC X and DEC X update Z/N and wrap', () => {
    const apu: any = new APUDevice();
    const pc = 0x0F00;

    // X=0xFF -> INC X -> 0x00 (Z=1), then DEC X -> 0xFF (N=1)
    apu.smp.X = 0xFF;
    apu.smp.PSW = 0x09; // set C and H to check preservation (V=0)

    apu.aram[pc + 0] = 0x3D; // INC X
    apu.aram[pc + 1] = 0x1D; // DEC X

    apu.smp.PC = pc;
    apu.step(16);

    expect(apu.smp.X & 0xff).toBe(0xFF);
    // After DEC X from 0x00 -> 0xFF: N=1, Z=0; C/V/H preserved (C=1, V=0, H=1)
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1);
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0);
    expect((apu.smp.PSW & 0x01) >>> 0).toBe(1);
    expect((apu.smp.PSW & 0x40) >>> 6).toBe(0);
    expect((apu.smp.PSW & 0x08) >>> 3).toBe(1);
  });

  it('INC Y and DEC Y update Z/N and wrap', () => {
    const apu: any = new APUDevice();
    const pc = 0x0F20;

    apu.smp.Y = 0x7F;
    apu.smp.PSW = 0x09; // C=1, H=1

    // INC Y -> 0x80 (N=1), DEC Y -> 0x7F (N=0)
    apu.aram[pc + 0] = 0xFC; // INC Y
    apu.aram[pc + 1] = 0xDC; // DEC Y

    apu.smp.PC = pc;
    apu.step(24);

    expect(apu.smp.Y & 0xff).toBe(0x7F);
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0);
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0);
    // C/H preserved
    expect((apu.smp.PSW & 0x01) >>> 0).toBe(1);
    expect((apu.smp.PSW & 0x08) >>> 3).toBe(1);
  });

  it('INC dp and DEC dp update memory and flags', () => {
    const apu: any = new APUDevice();
    const pc = 0x0F40;

    apu.smp.PSW = 0x00; // P=0 => DP base = $00
    apu.aram[0x0020] = 0xFF; // for INC -> 0x00 (Z=1)
    apu.aram[0x0021] = 0x00; // for DEC -> 0xFF (N=1)

    apu.aram[pc + 0] = 0xAB; apu.aram[pc + 1] = 0x20; // INC $20
    apu.aram[pc + 2] = 0x8B; apu.aram[pc + 3] = 0x21; // DEC $21

    apu.smp.PC = pc;
    apu.step(32);

    expect(apu.aram[0x0020] & 0xff).toBe(0x00);
    expect(apu.aram[0x0021] & 0xff).toBe(0xFF);
    // Last op was DEC -> N=1, Z=0
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1);
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0);
  });

  it('INC $dp+X and DEC $dp+X index correctly and update flags', () => {
    const apu: any = new APUDevice();
    const pc = 0x0F60;

    apu.smp.PSW = 0x00; // P=0
    apu.smp.X = 0x01;
    apu.aram[0x0030] = 0x7F; // effective for $2F+X
    apu.aram[0x0031] = 0x00; // effective for $30+X

    apu.aram[pc + 0] = 0xBB; apu.aram[pc + 1] = 0x2F; // INC $2F+X -> $30: 0x7F->0x80 (N=1)
    apu.aram[pc + 2] = 0x9B; apu.aram[pc + 3] = 0x30; // DEC $30+X -> $31: 0x00->0xFF (N=1)

    apu.smp.PC = pc;
    apu.step(40);

    expect(apu.aram[0x0030] & 0xff).toBe(0x80);
    expect(apu.aram[0x0031] & 0xff).toBe(0xFF);
    // Last op was DEC -> N=1, Z=0
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1);
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0);
  });
});

