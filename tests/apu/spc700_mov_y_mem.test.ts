import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// MOV Y <-> memory forms (dp, dp+X, abs)

describe('SMP MOV Y <-> memory (dp, dp+X, abs)', () => {
  it('MOV Y,dp and MOV dp,Y round-trip preserves PSW on store', () => {
    const apu: any = new APUDevice();
    const pc = 0x1100;

    apu.smp.PSW = 0x85; // P=0
    apu.aram[0x0040] = 0x01; // source dp

    apu.aram[pc + 0] = 0xF6; apu.aram[pc + 1] = 0x40; // LDY $40
    apu.aram[pc + 2] = 0xD6; apu.aram[pc + 3] = 0x41; // STY $41

    apu.smp.PC = pc;
    apu.step(32);

    expect(apu.smp.Y & 0xff).toBe(0x01);
    expect(apu.aram[0x0041] & 0xff).toBe(0x01);
    // After MOV Y,dp with Y=0x01 => N=0, Z=0; store preserves remaining PSW bits
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0);
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0);
  });

  it('MOV Y,dp+X and MOV dp+X,Y with DP+X addressing', () => {
    const apu: any = new APUDevice();
    const pc = 0x1120;

    apu.smp.PSW = 0x00; // P=0
    apu.smp.X = 0x02;
    apu.aram[0x0052] = 0x80; // effective for $50+X

    apu.aram[pc + 0] = 0xFA; apu.aram[pc + 1] = 0x50; // LDY $50+X -> $52
    apu.aram[pc + 2] = 0xD7; apu.aram[pc + 3] = 0x51; // STY $51+X -> $53

    apu.smp.PC = pc;
    apu.step(40);

    expect(apu.smp.Y & 0xff).toBe(0x80);
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1); // N=1 after load
    expect(apu.aram[0x0053] & 0xff).toBe(0x80);
  });

  it('MOV Y,abs and MOV abs,Y', () => {
    const apu: any = new APUDevice();
    const pc = 0x1140;

    apu.aram[0x2234] = 0x7F;

    apu.aram[pc + 0] = 0xEC; apu.aram[pc + 1] = 0x34; apu.aram[pc + 2] = 0x22; // MOV Y,$2234
    apu.aram[pc + 3] = 0xCC; apu.aram[pc + 4] = 0x35; apu.aram[pc + 5] = 0x22; // MOV $2235,Y

    apu.smp.PC = pc;
    apu.step(48);

    expect(apu.smp.Y & 0xff).toBe(0x7F);
    expect(apu.aram[0x2235] & 0xff).toBe(0x7F);
  });
});

