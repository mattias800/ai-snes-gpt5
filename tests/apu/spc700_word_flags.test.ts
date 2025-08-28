import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Verify flags for ADDW/SUBW/CMPW on YA with dp operands.

describe('SMP word ops flags: ADDW/SUBW/CMPW', () => {
  it('ADDW YA,dp sets C on 0xFFFF + 0x0001 -> 0x0000 and Z=1', () => {
    const apu: any = new APUDevice();
    const pc = 0x1680;

    // YA = 0xFFFF
    apu.smp.A = 0xFF; apu.smp.Y = 0xFF;
    // dp $20 = 0x0001
    apu.aram[0x0020] = 0x01; apu.aram[0x0021] = 0x00;

    apu.aram[pc + 0] = 0x7A; apu.aram[pc + 1] = 0x20; // ADDW YA,$20

    apu.smp.PC = pc;
    apu.step(24);

    expect(((apu.smp.Y << 8) | apu.smp.A) & 0xffff).toBe(0x0000);
    expect(apu.smp.PSW & 0x01).toBe(0x01); // C=1
    expect(apu.smp.PSW & 0x02).toBe(0x02); // Z=1
  });

  it('SUBW YA,dp clears C when YA < M (borrow), sets N on negative result', () => {
    const apu: any = new APUDevice();
    const pc = 0x16A0;

    // YA = 0x0000, M = 0x0001 -> result 0xFFFF
    apu.smp.A = 0x00; apu.smp.Y = 0x00;
    apu.aram[0x0022] = 0x01; apu.aram[0x0023] = 0x00;

    apu.aram[pc + 0] = 0x9A; apu.aram[pc + 1] = 0x22; // SUBW YA,$22

    apu.smp.PC = pc;
    apu.step(24);

    expect(((apu.smp.Y << 8) | apu.smp.A) & 0xffff).toBe(0xFFFF);
    expect(apu.smp.PSW & 0x01).toBe(0x00); // C=0
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1); // N=1
    expect(apu.smp.PSW & 0x02).toBe(0x00); // Z=0
  });

  it('SUBW YA,dp sets Z|C when YA == M', () => {
    const apu: any = new APUDevice();
    const pc = 0x16C0;

    // YA = 0x1234, M=0x1234 -> result 0x0000, C=1
    apu.smp.A = 0x34; apu.smp.Y = 0x12;
    apu.aram[0x0024] = 0x34; apu.aram[0x0025] = 0x12;

    apu.aram[pc + 0] = 0x9A; apu.aram[pc + 1] = 0x24; // SUBW YA,$24

    apu.smp.PC = pc;
    apu.step(24);

    expect(((apu.smp.Y << 8) | apu.smp.A) & 0xffff).toBe(0x0000);
    expect(apu.smp.PSW & 0x01).toBe(0x01); // C=1
    expect(apu.smp.PSW & 0x02).toBe(0x02); // Z=1
  });

  it('CMPW YA,dp sets C when YA >= M and Z when equal', () => {
    const apu: any = new APUDevice();
    const pc = 0x16E0;

    // YA=0x2000, M=0x1FFF -> r=0x0001, C=1, Z=0
    apu.smp.A = 0x00; apu.smp.Y = 0x20;
    apu.aram[0x0026] = 0xFF; apu.aram[0x0027] = 0x1F;
    apu.aram[pc + 0] = 0x5A; apu.aram[pc + 1] = 0x26; // CMPW YA,$26

    apu.smp.PC = pc;
    apu.step(16);

    expect(apu.smp.PSW & 0x01).toBe(0x01); // C=1
    expect(apu.smp.PSW & 0x02).toBe(0x00); // Z=0
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0); // N=0
  });
});

