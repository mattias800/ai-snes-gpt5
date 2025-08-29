import { describe, it, expect } from 'vitest';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';
import { TimingScheduler } from '../../../src/emulator/scheduler_timing';

// Verify onVBlankStart fires exactly once per frame.
describe('PPU timing: NMI/VBlank start callback fires once per frame', () => {
  it('onVBlankStart called once per frame', () => {
    const ppu = new TimingPPU();
    ppu.reset();
    let pulses = 0;
    const sched = new TimingScheduler(ppu, { onVBlankStart: () => { pulses++; } });

    // First frame
    sched.stepFrame();
    expect(pulses).toBe(1);

    // Second frame
    sched.stepFrame();
    expect(pulses).toBe(2);
  });
});

