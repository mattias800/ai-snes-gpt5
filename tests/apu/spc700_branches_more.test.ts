import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Additional coverage for SPC700 branch instructions and BRA negative offsets

describe('SMP branches: BVC/BVS and companion cases', () => {
  it('BVC taken when V=0, skips following MOV', () => {
    const apu: any = new APUDevice();
    const pc = 0x0B00;
    // MOV A,#$77; BVC +2; MOV A,#$00 (skipped)
    apu.aram[pc + 0] = 0xE8; apu.aram[pc + 1] = 0x77;
    apu.aram[pc + 2] = 0x50; apu.aram[pc + 3] = 0x02; // BVC +2
    apu.aram[pc + 4] = 0xE8; apu.aram[pc + 5] = 0x00; // should be skipped

    apu.smp.PSW &= ~0x40; // V=0
    apu.smp.PC = pc;
    apu.step(48);
    expect(apu.smp.A & 0xff).toBe(0x77);
  });

  it('BVC not taken when V=1, executes following MOV', () => {
    const apu: any = new APUDevice();
    const pc = 0x0B20;
    // BVC +2; MOV A,#$23
    apu.aram[pc + 0] = 0x50; apu.aram[pc + 1] = 0x02;
    apu.aram[pc + 2] = 0xE8; apu.aram[pc + 3] = 0x23;

    apu.smp.PSW |= 0x40; // V=1
    apu.smp.PC = pc;
    apu.step(32);
    expect(apu.smp.A & 0xff).toBe(0x23);
  });

  it('BVS taken when V=1, skips following MOV', () => {
    const apu: any = new APUDevice();
    const pc = 0x0B40;
    // MOV A,#$66; BVS +2; MOV A,#$00
    apu.aram[pc + 0] = 0xE8; apu.aram[pc + 1] = 0x66;
    apu.aram[pc + 2] = 0x70; apu.aram[pc + 3] = 0x02; // BVS +2
    apu.aram[pc + 4] = 0xE8; apu.aram[pc + 5] = 0x00; // skipped

    apu.smp.PSW |= 0x40; // V=1
    apu.smp.PC = pc;
    apu.step(48);
    expect(apu.smp.A & 0xff).toBe(0x66);
  });

  it('BVS not taken when V=0, executes following MOV', () => {
    const apu: any = new APUDevice();
    const pc = 0x0B60;
    // BVS +2; MOV A,#$23
    apu.aram[pc + 0] = 0x70; apu.aram[pc + 1] = 0x02; // BVS +2
    apu.aram[pc + 2] = 0xE8; apu.aram[pc + 3] = 0x23;

    apu.smp.PSW &= ~0x40; // V=0
    apu.smp.PC = pc;
    apu.step(32);
    expect(apu.smp.A & 0xff).toBe(0x23);
  });
});

describe('SMP branches: missing opposite cases for BEQ/BCC/BCS/BMI/BPL', () => {
  it('BEQ not taken when Z=0 executes following MOV', () => {
    const apu: any = new APUDevice();
    const pc = 0x0B80;
    // BEQ +2; MOV A,#$23
    apu.aram[pc + 0] = 0xF0; apu.aram[pc + 1] = 0x02;
    apu.aram[pc + 2] = 0xE8; apu.aram[pc + 3] = 0x23;

    apu.smp.PSW &= ~0x02; // Z=0
    apu.smp.PC = pc;
    apu.step(32);
    expect(apu.smp.A & 0xff).toBe(0x23);
  });

  it('BCC taken when C=0, skips following MOV', () => {
    const apu: any = new APUDevice();
    const pc = 0x0BA0;
    // MOV A,#$55; BCC +2; MOV A,#$00
    apu.aram[pc + 0] = 0xE8; apu.aram[pc + 1] = 0x55;
    apu.aram[pc + 2] = 0x90; apu.aram[pc + 3] = 0x02;
    apu.aram[pc + 4] = 0xE8; apu.aram[pc + 5] = 0x00;

    apu.smp.PSW &= ~0x01; // C=0
    apu.smp.PC = pc;
    apu.step(48);
    expect(apu.smp.A & 0xff).toBe(0x55);
  });

  it('BCS not taken when C=0 executes following MOV', () => {
    const apu: any = new APUDevice();
    const pc = 0x0BC0;
    // BCS +2; MOV A,#$23
    apu.aram[pc + 0] = 0xB0; apu.aram[pc + 1] = 0x02;
    apu.aram[pc + 2] = 0xE8; apu.aram[pc + 3] = 0x23;

    apu.smp.PSW &= ~0x01; // C=0
    apu.smp.PC = pc;
    apu.step(32);
    expect(apu.smp.A & 0xff).toBe(0x23);
  });

  it('BMI not taken when N=0 executes following MOV', () => {
    const apu: any = new APUDevice();
    const pc = 0x0BE0;
    // BMI +2; MOV A,#$23
    apu.aram[pc + 0] = 0x30; apu.aram[pc + 1] = 0x02;
    apu.aram[pc + 2] = 0xE8; apu.aram[pc + 3] = 0x23;

    apu.smp.PSW &= ~0x80; // N=0
    apu.smp.PC = pc;
    apu.step(32);
    expect(apu.smp.A & 0xff).toBe(0x23);
  });

  it('BPL not taken when N=1 executes following MOV', () => {
    const apu: any = new APUDevice();
    const pc = 0x0C00;
    // BPL +2; MOV A,#$23
    apu.aram[pc + 0] = 0x10; apu.aram[pc + 1] = 0x02;
    apu.aram[pc + 2] = 0xE8; apu.aram[pc + 3] = 0x23;

    apu.smp.PSW |= 0x80; // N=1
    apu.smp.PC = pc;
    apu.step(32);
    expect(apu.smp.A & 0xff).toBe(0x23);
  });
});

describe('SMP BRA: negative offset updates PC correctly', () => {
  it('BRA -4 sets PC = pc+2-4', () => {
    const apu: any = new APUDevice();
    const pc = 0x0C20;
    // BRA -4 (0xFC)
    apu.aram[pc + 0] = 0x2F; // BRA
    apu.aram[pc + 1] = 0xFC; // -4

    apu.smp.PC = pc;
    apu.step(2); // BRA is 2 cycles

    const expected = (pc + 2 - 4) & 0xffff; // signed rel8 (-4)
    expect(apu.smp.PC & 0xffff).toBe(expected);
  });
});

