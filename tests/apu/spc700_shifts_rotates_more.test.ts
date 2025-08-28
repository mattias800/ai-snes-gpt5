import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Additional shift/rotate coverage focusing on carry-in/out behavior.

describe('SMP shifts/rotates: carry-in/out behavior', () => {
  it('ROL dp uses carry-in: 0x00 with C=1 -> 0x01, C=0, Z=0, N=0', () => {
    const apu: any = new APUDevice();
    const pc = 0x1700;
    apu.aram[0x0040] = 0x00;
    apu.smp.PSW = 0x01; // C=1
    apu.aram[pc + 0] = 0x2B; apu.aram[pc + 1] = 0x40; // ROL $40
    apu.smp.PC = pc;
    apu.step(16);
    expect(apu.aram[0x0040] & 0xff).toBe(0x01);
    expect(apu.smp.PSW & 0x01).toBe(0x00); // C=0
    expect(apu.smp.PSW & 0x02).toBe(0x00); // Z=0
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0); // N=0
  });

  it('ROR dp uses carry-in -> bit7: 0x00 with C=1 -> 0x80, C=0, N=1', () => {
    const apu: any = new APUDevice();
    const pc = 0x1720;
    apu.aram[0x0041] = 0x00;
    apu.smp.PSW = 0x01; // C=1
    apu.aram[pc + 0] = 0x6B; apu.aram[pc + 1] = 0x41; // ROR $41
    apu.smp.PC = pc;
    apu.step(16);
    expect(apu.aram[0x0041] & 0xff).toBe(0x80);
    expect(apu.smp.PSW & 0x01).toBe(0x00); // C from bit0
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1); // N=1
    expect(apu.smp.PSW & 0x02).toBe(0x00); // Z=0
  });

  it('ROL dp+X with carry-out from bit7 sets C=1', () => {
    const apu: any = new APUDevice();
    const pc = 0x1740;
    apu.smp.X = 0x02;
    apu.aram[0x0052] = 0x80; // will shift out 1
    apu.smp.PSW = 0x00; // C=0
    apu.aram[pc + 0] = 0x3B; apu.aram[pc + 1] = 0x50; // ROL $50+X -> $52
    apu.smp.PC = pc;
    apu.step(16);
    expect(apu.aram[0x0052] & 0xff).toBe(0x00);
    expect(apu.smp.PSW & 0x01).toBe(0x01); // C=1
    expect(apu.smp.PSW & 0x02).toBe(0x02); // Z=1
  });

  it('ROR abs with LSB=1 sets C=1 and Z depends on result', () => {
    const apu: any = new APUDevice();
    const pc = 0x1760;
    apu.aram[0x6000] = 0x01;
    apu.smp.PSW = 0x00; // C=0
    apu.aram[pc + 0] = 0x6C; apu.aram[pc + 1] = 0x00; apu.aram[pc + 2] = 0x60; // ROR $6000
    apu.smp.PC = pc;
    apu.step(16);
    expect(apu.aram[0x6000] & 0xff).toBe(0x00);
    expect(apu.smp.PSW & 0x01).toBe(0x01); // C=1
    expect(apu.smp.PSW & 0x02).toBe(0x02); // Z=1
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0); // N=0
  });
});

