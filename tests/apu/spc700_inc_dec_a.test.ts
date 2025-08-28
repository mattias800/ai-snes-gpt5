import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Tests for INC A (0xBC) and DEC A (0x9C)

describe('SMP INC/DEC A', () => {
  it('INC A increments and updates Z/N only', () => {
    const apu: any = new APUDevice();
    const pc = 0x0D40;

    // Program: MOV A,#$0F; SETC; INC A; then MOV A,#$FF; INC A (wrap to 0 -> Z=1)
    apu.aram[pc + 0] = 0xE8; apu.aram[pc + 1] = 0x0F; // MOV A,#$0F
    apu.aram[pc + 2] = 0x80; // SETC (C=1, should remain unchanged by INC)
    apu.aram[pc + 3] = 0xBC; // INC A -> 0x10
    apu.aram[pc + 4] = 0xE8; apu.aram[pc + 5] = 0xFF; // MOV A,#$FF
    apu.aram[pc + 6] = 0xBC; // INC A -> 0x00 (Z=1)

    // Precondition: set V=1, H=1 so we can observe they remain unaffected
    apu.smp.PSW |= 0x40; // V=1
    apu.smp.PSW |= 0x08; // H=1

    apu.smp.PC = pc;
    apu.step(64);

    // After first INC A: A=0x10
    // After second INC A: A=0x00, Z=1
    expect(apu.smp.A & 0xff).toBe(0x00);
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(1); // Z=1
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0); // N=0
    // C,V,H unaffected (C remained set, V/H remained set)
    expect((apu.smp.PSW & 0x01) >>> 0).toBe(1); // C=1
    expect((apu.smp.PSW & 0x40) >>> 6).toBe(1); // V=1
    expect((apu.smp.PSW & 0x08) >>> 3).toBe(1); // H=1
  });

  it('DEC A decrements and updates Z/N only', () => {
    const apu: any = new APUDevice();
    const pc = 0x0D80;

    // Program: MOV A,#$01; DEC A -> 0x00 (Z=1)
    // Then MOV A,#$00; DEC A -> 0xFF (N=1)
    apu.aram[pc + 0] = 0xE8; apu.aram[pc + 1] = 0x01; // MOV A,#$01
    apu.aram[pc + 2] = 0x9C; // DEC A -> 0x00
    apu.aram[pc + 3] = 0xE8; apu.aram[pc + 4] = 0x00; // MOV A,#$00
    apu.aram[pc + 5] = 0x9C; // DEC A -> 0xFF

    // Precondition: set C=1, V=1, H=1 so we can observe they remain unaffected
    apu.smp.PSW |= 0x01 | 0x40 | 0x08;

    apu.smp.PC = pc;
    apu.step(64);

    // After second DEC: A=0xFF; N=1; Z=0
    expect(apu.smp.A & 0xff).toBe(0xFF);
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1); // N=1
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0); // Z=0
    // C,V,H unaffected
    expect((apu.smp.PSW & 0x01) >>> 0).toBe(1);
    expect((apu.smp.PSW & 0x40) >>> 6).toBe(1);
    expect((apu.smp.PSW & 0x08) >>> 3).toBe(1);
  });
});

