import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Test MOV dp,#imm (0x8F) respects PSW.P for DP base and does not modify PSW.

describe('SMP MOV dp,#imm respects DP base and preserves PSW', () => {
  it('writes to $00xx when P=0 and leaves PSW unchanged', () => {
    const apu: any = new APUDevice();
    const pc = 0x1600;

    apu.smp.PSW = 0x8B; // sentinel flags with P=0
    // MOV $12,#$5A
    apu.aram[pc + 0] = 0x8F; // MOV dp,#imm
    apu.aram[pc + 1] = 0x5A; // imm
    apu.aram[pc + 2] = 0x12; // dp

    apu.smp.PC = pc;
    apu.step(24);

    expect(apu.aram[0x0012] & 0xff).toBe(0x5A);
    expect(apu.aram[0x0112] & 0xff).toBe(0x00);
    expect(apu.smp.PSW & 0xff).toBe(0x8B);
  });

  it('writes to $01xx when P=1 and leaves PSW unchanged', () => {
    const apu: any = new APUDevice();
    const pc = 0x1620;

    apu.smp.PSW = 0xAB | 0x20; // set P=1
    apu.aram[pc + 0] = 0x8F; // MOV dp,#imm
    apu.aram[pc + 1] = 0x77; // imm
    apu.aram[pc + 2] = 0x34; // dp

    apu.smp.PC = pc;
    apu.step(24);

    expect(apu.aram[0x0034] & 0xff).toBe(0x00);
    expect(apu.aram[0x0134] & 0xff).toBe(0x77);
    expect(apu.smp.PSW & 0xff).toBe(0xAB | 0x20);
  });
});

