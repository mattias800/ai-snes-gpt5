import { describe, it, expect } from 'vitest';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';

// Verify $2137 latch behavior and $213C-$213F reads.
describe('PPU timing: $2137 HV latch and $213C-$213F counter reads', () => {
  it('latches H and V; low reads repeat until high is read; high read clears latch for that counter', () => {
    const ppu = new TimingPPU();
    ppu.reset();

    // Advance to a known position
    // Move to scanline 10, dot 123
    for (let sl = 0; sl < 10; sl++) ppu.stepScanline();
    for (let d = 0; d < 123; d++) ppu.stepDot();

    const hAtLatch = ppu.getHCounter() & 0xffff;
    const vAtLatch = ppu.getVCounter() & 0xffff;

    // Write $2137 to latch HV
    ppu.writeReg(0x37, 0x00);

    // Read OPHCT low twice; should be the same (latched)
    const hL1 = ppu.readReg(0x3c);
    const hL2 = ppu.readReg(0x3c);
    expect(hL1).toBe(hAtLatch & 0xff);
    expect(hL2).toBe(hAtLatch & 0xff);

    // Read OPHCT high; clears H latch
    const hH = ppu.readReg(0x3d);
    expect(hH).toBe((hAtLatch >>> 8) & 0xff);

    // Read OPVCT low/high (V latch still valid)
    const vL = ppu.readReg(0x3e);
    const vH = ppu.readReg(0x3f);
    expect(vL).toBe(vAtLatch & 0xff);
    expect(vH).toBe((vAtLatch >>> 8) & 0xff);

    // After clearing both latches, counters should read live values (advance some dots)
    for (let d = 0; d < 5; d++) ppu.stepDot();
    const liveH = ppu.getHCounter() & 0xffff;
    const readHLo = ppu.readReg(0x3c);
    expect(readHLo).toBe(liveH & 0xff);
  });
});

