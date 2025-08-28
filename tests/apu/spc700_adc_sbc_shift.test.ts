import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

describe('SMP ADC/SBC and shifts/rotates on A', () => {
  it('ADC half-carry edges and overflow (0x0F+1, 0xF0+0x10, 0x7F+1)', () => {
    const apu: any = new APUDevice();

    // Case A: 0x0F + 0x01, C=0 -> H=1, C=0, A=0x10
    let pc = 0x0500;
    apu.aram[pc + 0] = 0xE8; // MOV A,#
    apu.aram[pc + 1] = 0x0F;
    apu.aram[pc + 2] = 0x88; // ADC #
    apu.aram[pc + 3] = 0x01;
    apu.smp.PSW &= ~0x01; // C=0
    apu.smp.PC = pc;
    apu.step(32);
    expect(apu.smp.A & 0xff).toBe(0x10);
    expect((apu.smp.PSW & 0x08) >>> 3).toBe(1); // H=1
    expect((apu.smp.PSW & 0x01) >>> 0).toBe(0); // C=0

    // Case B: 0xF0 + 0x10, C=0 -> H=0, C=1, A=0x00, Z=1
    pc = 0x0520;
    apu.aram[pc + 0] = 0xE8; // MOV A,#
    apu.aram[pc + 1] = 0xF0;
    apu.aram[pc + 2] = 0x88; // ADC #
    apu.aram[pc + 3] = 0x10;
    apu.smp.PSW &= ~0x01; // C=0
    apu.smp.PC = pc;
    apu.step(32);
    expect(apu.smp.A & 0xff).toBe(0x00);
    expect((apu.smp.PSW & 0x08) >>> 3).toBe(0); // H=0
    expect((apu.smp.PSW & 0x01) >>> 0).toBe(1); // C=1
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(1); // Z=1

    // Case C: 0x7F + 0x01 -> V=1, N=1, result 0x80
    pc = 0x0540;
    apu.aram[pc + 0] = 0xE8; // MOV A,#
    apu.aram[pc + 1] = 0x7F;
    apu.aram[pc + 2] = 0x88; // ADC #
    apu.aram[pc + 3] = 0x01;
    apu.smp.PSW &= ~0x01; // C=0
    apu.smp.PC = pc;
    apu.step(32);
    expect(apu.smp.A & 0xff).toBe(0x80);
    expect((apu.smp.PSW & 0x40) >>> 6).toBe(1); // V=1
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1); // N=1
  });

  it('SBC overflow case 0x80 - 0x01 (C=1) -> V=1, C=1, A=0x7F', () => {
    const apu: any = new APUDevice();
    const pc = 0x0560;
    apu.aram[pc + 0] = 0xE8; // MOV A,#
    apu.aram[pc + 1] = 0x80;
    apu.aram[pc + 2] = 0xA8; // SBC #
    apu.aram[pc + 3] = 0x01;
    apu.smp.PSW |= 0x01; // C=1
    apu.smp.PC = pc;
    apu.step(32);
    expect(apu.smp.A & 0xff).toBe(0x7F);
    expect((apu.smp.PSW & 0x01) >>> 0).toBe(1); // C=1 (no borrow)
    expect((apu.smp.PSW & 0x40) >>> 6).toBe(1); // V=1
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0); // N=0
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0); // Z=0
  });

  it('ASL/LSR/ROL/ROR A flags and behavior', () => {
    const apu: any = new APUDevice();

    // ASL A: 0x80 -> 0x00, C=1, Z=1
    let pc = 0x0580;
    apu.aram[pc + 0] = 0xE8; // MOV A,#
    apu.aram[pc + 1] = 0x80;
    apu.aram[pc + 2] = 0x1C; // ASL A
    apu.smp.PC = pc;
    apu.step(32);
    expect(apu.smp.A & 0xff).toBe(0x00);
    expect((apu.smp.PSW & 0x01) >>> 0).toBe(1); // C=1
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(1); // Z=1
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0); // N=0

    // LSR A: 0x01 -> 0x00, C=1, Z=1, N=0
    pc = 0x05A0;
    apu.aram[pc + 0] = 0xE8; // MOV A,#
    apu.aram[pc + 1] = 0x01;
    apu.aram[pc + 2] = 0x5C; // LSR A
    apu.smp.PC = pc;
    apu.step(32);
    expect(apu.smp.A & 0xff).toBe(0x00);
    expect((apu.smp.PSW & 0x01) >>> 0).toBe(1); // C=1
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(1); // Z=1
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0); // N=0

    // ROL A with C=1: 0x7F -> 0xFF, C=0, N=1
    pc = 0x05C0;
    apu.aram[pc + 0] = 0xE8; // MOV A,#
    apu.aram[pc + 1] = 0x7F;
    apu.aram[pc + 2] = 0x3C; // ROL A
    apu.smp.PSW |= 0x01; // C=1
    apu.smp.PC = pc;
    apu.step(32);
    expect(apu.smp.A & 0xff).toBe(0xFF);
    expect((apu.smp.PSW & 0x01) >>> 0).toBe(0); // C=0 (old bit7)
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1); // N=1

    // ROR A with C=0: 0x02 -> 0x01, C=0, N=0, Z=0
    pc = 0x05E0;
    apu.aram[pc + 0] = 0xE8; // MOV A,#
    apu.aram[pc + 1] = 0x02;
    apu.aram[pc + 2] = 0x7C; // ROR A
    apu.smp.PSW &= ~0x01; // C=0
    apu.smp.PC = pc;
    apu.step(32);
    expect(apu.smp.A & 0xff).toBe(0x01);
    expect((apu.smp.PSW & 0x01) >>> 0).toBe(0); // C=0 (old bit0)
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0); // N=0
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0); // Z=0
  });
});
