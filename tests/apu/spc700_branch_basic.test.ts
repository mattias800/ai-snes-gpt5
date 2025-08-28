import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Basic BRA rel8 test: ensure relative jump skips over the next instruction.

describe('SMP branches: BRA rel8', () => {
  it('BRA skips next MOV A,# when offset +2', () => {
    const apu: any = new APUDevice();
    const pc = 0x0700;
    // mov a,#$11; bra +2; mov a,#$22
    apu.aram[pc + 0] = 0xE8; // MOV A,#
    apu.aram[pc + 1] = 0x11;
    apu.aram[pc + 2] = 0x2F; // BRA rel8
    apu.aram[pc + 3] = 0x02; // skip the next 2 bytes
    apu.aram[pc + 4] = 0xE8; // MOV A,# (should be skipped)
    apu.aram[pc + 5] = 0x22;

    apu.smp.PC = pc;
    apu.step(48);

    expect(apu.smp.A & 0xff).toBe(0x11);
  });
});
