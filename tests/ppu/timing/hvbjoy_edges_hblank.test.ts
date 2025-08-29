import { describe, it, expect } from 'vitest';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';

// Validate HBlank toggling across the scanline using the TimingPPU dot counter.
describe('PPU timing: HBlank edges per dot (scaffold)', () => {
  it('HBlank becomes true at the configured late-line dot and resets at next line', () => {
    const ppu = new TimingPPU();
    ppu.reset();

    // Advance near end of first scanline
    // We don't know the exact constant here (scaffold uses ~7/8). We can detect the first dot where HBlank becomes true.
    let hbDot = -1;
    for (let d = 0; d < 400; d++) {
      if (ppu.isHBlank()) { hbDot = ppu.getHCounter(); break; }
      ppu.stepDot();
    }
    expect(hbDot).toBeGreaterThan(0);

    // HBlank should remain true until end of line (wrap to dot 0)
    const dotAtDetect = hbDot;
    while (ppu.getHCounter() !== 0) {
      expect(ppu.isHBlank()).toBe(true);
      ppu.stepDot();
    }

    // At new line dot 0, HBlank should be false
    expect(ppu.getHCounter()).toBe(0);
    expect(ppu.isHBlank()).toBe(false);

    // And HBlank should re-occur later in the line again
    let seenAgain = false;
    for (let i = 0; i < dotAtDetect + 2; i++) {
      ppu.stepDot();
      if (ppu.isHBlank()) { seenAgain = true; break; }
    }
    expect(seenAgain).toBe(true);
  });
});

