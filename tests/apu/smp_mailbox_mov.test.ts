import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

describe('SMP can move A to $F7 via direct-page MOV dp,A', () => {
  it('writes A to APU->CPU port 3 ($F7) and CPU sees it at $2143', () => {
    const apu: any = new APUDevice();
    // Assemble: MOV A,#$77 (E8 77), MOV $F7,A (C5 F7)
    apu.aram[0x0200] = 0xE8;
    apu.aram[0x0201] = 0x77;
    apu.aram[0x0202] = 0xC5;
    apu.aram[0x0203] = 0xF7;

    // Reset SMP and set PC, clear P so DP base is $00xx
    apu.smp.PSW = 0x00;
    apu.smp.PC = 0x0200;

    // Step enough slices to cover both instructions
    apu.step(32);

    const cpuRead = apu.cpuReadPort(3);
    expect(cpuRead).toBe(0x77);
  });
});
