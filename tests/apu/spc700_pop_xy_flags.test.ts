import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// POP X (0xCE) and POP Y (0xEE) should not modify PSW flags in our core.

describe('SMP POP X/Y flags unaffected', () => {
  it('POP X loads X from stack but preserves PSW', () => {
    const apu: any = new APUDevice();
    const pc = 0x1640;

    // Preseed stack: with SP=0xFE, POP reads from $01FF
    apu.smp.SP = 0xFE;
    apu.aram[0x01FF] = 0x00; // value to pop (would set Z if flags were updated)

    // Set PSW to a sentinel with N|Z set so we can detect unwanted changes
    apu.smp.PSW = 0x80 | 0x02 | 0x10; // N=1, Z=1, B=1 for variety

    apu.aram[pc + 0] = 0xCE; // POP X

    apu.smp.PC = pc;
    apu.step(24);

    expect(apu.smp.X & 0xff).toBe(0x00);
    // Ensure PSW unchanged (still has N|Z|B)
    expect(apu.smp.PSW & 0xff).toBe(0x92);
  });

  it('POP Y loads Y from stack but preserves PSW', () => {
    const apu: any = new APUDevice();
    const pc = 0x1660;

    // Preseed stack: with SP=0xFD, POP reads $01FE then SP=0xFE
    apu.smp.SP = 0xFD;
    apu.aram[0x01FE] = 0x80; // would set N if flags were updated

    apu.smp.PSW = 0x01; // C=1 as sentinel

    apu.aram[pc + 0] = 0xEE; // POP Y

    apu.smp.PC = pc;
    apu.step(24);

    expect(apu.smp.Y & 0xff).toBe(0x80);
    expect(apu.smp.PSW & 0xff).toBe(0x01); // unchanged
  });
});

