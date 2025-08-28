import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Verify PUSH/POP A/X/Y/PSW semantics and SP updates on the $0100 page.

describe('SMP stack and PSW behavior', () => {
  it('PUSH A writes to $01FF then decrements SP; POP A restores and increments SP', () => {
    const apu: any = new APUDevice();
    const pc = 0x0800;

    // Initialize state
    apu.smp.SP = 0xff; // top of stack
    apu.smp.A = 0x12;

    // Program: PUSH A; POP A
    apu.aram[pc + 0] = 0x2D; // PUSH A
    apu.aram[pc + 1] = 0xAE; // POP A

    apu.smp.PC = pc;
    apu.step(32);

    // After PUSH: SP should have been FE and memory at 0x01FF should be 0x12
    // After POP: SP back to FF and A restored to 0x12
    expect(apu.smp.A & 0xff).toBe(0x12);
    expect(apu.smp.SP & 0xff).toBe(0xff);
    expect(apu.aram[0x01ff] & 0xff).toBe(0x12);
  });

  it('PUSH X/Y and POP X/Y round-trip with correct stack order', () => {
    const apu: any = new APUDevice();
    const pc = 0x0820;
    apu.smp.SP = 0xff;
    apu.smp.X = 0x34;
    apu.smp.Y = 0x56;

    // PUSH X; PUSH Y; POP Y; POP X
    apu.aram[pc + 0] = 0x4D; // PUSH X -> [$01FF]=0x34, SP=FE
    apu.aram[pc + 1] = 0x6D; // PUSH Y -> [$01FE]=0x56, SP=FD
    apu.aram[pc + 2] = 0xEE; // POP Y  <- 0x56, SP=FE
    apu.aram[pc + 3] = 0xCE; // POP X  <- 0x34, SP=FF

    apu.smp.PC = pc;
    apu.step(64);

    expect(apu.smp.X & 0xff).toBe(0x34);
    expect(apu.smp.Y & 0xff).toBe(0x56);
    expect(apu.smp.SP & 0xff).toBe(0xff);
    expect(apu.aram[0x01ff] & 0xff).toBe(0x34);
    expect(apu.aram[0x01fe] & 0xff).toBe(0x56);
  });

  it('PUSH PSW then POP PSW restores flags', () => {
    const apu: any = new APUDevice();
    const pc = 0x0840;

    // Set PSW to a known pattern: N|P|H|Z|C = 1
    apu.smp.PSW = 0x80 | 0x20 | 0x08 | 0x02 | 0x01;

    // PUSH PSW; then clear PSW; then POP PSW
    apu.aram[pc + 0] = 0x0D; // PUSH PSW
    apu.aram[pc + 1] = 0x60; // CLRC (as a way to modify PSW)
    apu.aram[pc + 2] = 0x8E; // POP PSW

    apu.smp.PC = pc;
    apu.step(64);

    expect(apu.smp.PSW & 0xff).toBe(0xAB); // N(0x80)+P(0x20)+H(0x08)+Z(0x02)+C(0x01) = 0xAB
  });
});
