import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Validate MOV dp,#imm (0x8F) and flags unaffected for MOV dp,A and MOVW dp,YA

describe('SMP memory move semantics', () => {
  it('MOV $nn,#imm writes immediate to DP and preserves PSW', () => {
    const apu: any = new APUDevice();
    const pc = 0x0E00;

    // PSW pattern to verify preservation (ensure P=0 for DP=$00)
    apu.smp.PSW = 0x8B; // arbitrary pattern with P cleared

    // mov $21,#$FE
    apu.aram[pc + 0] = 0x8F;
    apu.aram[pc + 1] = 0x21;
    apu.aram[pc + 2] = 0xFE;

    apu.smp.PC = pc;
    apu.step(8);

    expect(apu.aram[0x0021] & 0xff).toBe(0xFE);
    expect(apu.smp.PSW & 0xff).toBe(0x8B); // unchanged
  });

  it('MOV dp,A preserves PSW', () => {
    const apu: any = new APUDevice();
    const pc = 0x0E20;

    apu.smp.A = 0x00; // value doesn't matter for PSW test
    apu.smp.PSW = 0x5A;

    apu.aram[pc + 0] = 0xC4; apu.aram[pc + 1] = 0x40; // sta $40

    apu.smp.PC = pc;
    apu.step(8);

    expect(apu.aram[0x0040] & 0xff).toBe(0x00);
    expect(apu.smp.PSW & 0xff).toBe(0x5A);
  });

  it('MOVW dp,YA preserves PSW', () => {
    const apu: any = new APUDevice();
    const pc = 0x0E40;

    apu.smp.A = 0x34; apu.smp.Y = 0x12;
    apu.smp.PSW = 0xD0; // ensure P=0 so DP=$00

    apu.aram[pc + 0] = 0xDA; apu.aram[pc + 1] = 0x50; // movw $50,ya

    apu.smp.PC = pc;
    apu.step(8);

    expect(apu.aram[0x0050] & 0xff).toBe(0x34);
    expect(apu.aram[0x0051] & 0xff).toBe(0x12);
    expect(apu.smp.PSW & 0xff).toBe(0xD0);
  });
});

