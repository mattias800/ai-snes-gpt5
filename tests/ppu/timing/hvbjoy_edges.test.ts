import { describe, it, expect } from 'vitest';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';
import { TimingScheduler } from '../../../src/emulator/scheduler_timing';

// Smoke test for timing scaffolding: VBlank should become true starting at line >= 224 (scaffold constant).
describe('PPU timing scaffold: HVBJOY VBlank edge (coarse)', () => {
  it('VBlank flips when scanline reaches start (coarse model)', () => {
    const ppu = new TimingPPU();
    ppu.reset();
    const sched = new TimingScheduler(ppu);

    // Step until just before VBlank start line (223)
    for (let line = 0; line < 223; line++) sched.stepScanline();
    expect(ppu.getVCounter()).toBe(223);
    expect(ppu.isVBlank()).toBe(false);

    // Next scanline enters VBlank
    sched.stepScanline();
    expect(ppu.getVCounter()).toBe(224);
    expect(ppu.isVBlank()).toBe(true);
  });
});

