import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// MOV X <-> memory forms (dp, dp+Y, abs)

describe('SMP MOV X <-> memory (dp, dp+Y, abs)', () => {
  it('MOV X,dp and MOV dp,X round-trip preserves PSW on store', () => {
    const apu: any = new APUDevice();
    const pc = 0x1000;

    apu.smp.PSW = 0x85; // pattern (P=0 for DP=$00)
    apu.aram[0x0020] = 0x7F; // dp source

    // MOV X,$20; MOV $21,X
    apu.aram[pc + 0] = 0xF8; apu.aram[pc + 1] = 0x20; // MOV X,dp
    apu.aram[pc + 2] = 0xD8; apu.aram[pc + 3] = 0x21; // MOV dp,X

    apu.smp.PC = pc;
    apu.step(32);

    expect(apu.smp.X & 0xff).toBe(0x7F);
    expect(apu.aram[0x0021] & 0xff).toBe(0x7F);
    // After MOV X,dp, Z/N updated from X=0x7F -> N=0, Z=0; store preserves PSW
    expect(apu.smp.PSW & 0xff).toBe(0x05);
  });

  it('MOV X,dp+Y and MOV dp+Y,X with DP wrapping and Z/N updates on load', () => {
    const apu: any = new APUDevice();
    const pc = 0x1020;

    apu.smp.PSW = 0x00; // P=0 -> DP=$00
    apu.smp.Y = 0x01;
    apu.aram[0x0030] = 0x80; // effective for $2F+Y

    // X <- $2F+Y -> $30 (0x80 -> N=1), then $30+Y -> $31 store X
    apu.aram[pc + 0] = 0xFB; apu.aram[pc + 1] = 0x2F; // MOV X,$2F+Y
    apu.aram[pc + 2] = 0xDB; apu.aram[pc + 3] = 0x30; // MOV $30+Y,X (-> $31)

    apu.smp.PC = pc;
    apu.step(40);

    expect(apu.smp.X & 0xff).toBe(0x80);
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1); // N=1 from load
    expect(apu.aram[0x0031] & 0xff).toBe(0x80);
  });

  it('MOV X,abs and MOV abs,X', () => {
    const apu: any = new APUDevice();
    const pc = 0x1040;

    // Seed abs source 0x1234 -> 0x55
    apu.aram[0x1234] = 0x55;

    // X <- $1234; then store to $1235
    apu.aram[pc + 0] = 0xF9; apu.aram[pc + 1] = 0x34; apu.aram[pc + 2] = 0x12; // MOV X,$1234
    apu.aram[pc + 3] = 0xD9; apu.aram[pc + 4] = 0x35; apu.aram[pc + 5] = 0x12; // MOV $1235,X

    apu.smp.PC = pc;
    apu.step(48);

    expect(apu.smp.X & 0xff).toBe(0x55);
    expect(apu.aram[0x1235] & 0xff).toBe(0x55);
  });
});

