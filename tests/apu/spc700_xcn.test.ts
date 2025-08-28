import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// XCN A (0x9F): swap high/low nibbles of A; sets N/Z from result; C/V/H unaffected.

describe('SMP XCN A nibble swap', () => {
  it('swaps nibbles and updates N/Z only', () => {
    const apu: any = new APUDevice();

    // Program: mov a,#$1E; xcn a
    const pc = 0x0400;
    apu.aram[pc + 0] = 0xE8; // MOV A,#imm
    apu.aram[pc + 1] = 0x1E;
    apu.aram[pc + 2] = 0x9F; // XCN A

    // Set PSW with C=1, V=1, H=1 to verify they remain unchanged
    apu.smp.PSW = (apu.smp.PSW | 0x01 | 0x40 | 0x08) & 0xff;
    apu.smp.PC = pc;

    apu.step(32);

    expect(apu.smp.A & 0xff).toBe(0xE1);
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1); // N=1
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0); // Z=0
    // C,V,H unchanged (were set)
    expect(apu.smp.PSW & 0x01).toBe(0x01);
    expect(apu.smp.PSW & 0x40).toBe(0x40);
    expect(apu.smp.PSW & 0x08).toBe(0x08);
  });
});
