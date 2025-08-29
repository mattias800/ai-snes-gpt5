import { describe, it, expect } from 'vitest';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';

const OAMADDL = 0x02; // $2102
const OAMADDH = 0x03; // $2103
const OAMDATA = 0x04; // $2104
const OAMREAD = 0x38; // $2138

describe('PPU timing: OAM ports $2102/$2103/$2104/$2138 basic sequencing', () => {
  it('sets address and auto-increments on write and read', () => {
    const ppu = new TimingPPU(); ppu.reset();

    // Set address to 0x020
    ppu.writeReg(OAMADDL, 0x20);
    ppu.writeReg(OAMADDH, 0x00);

    // Write three bytes
    ppu.writeReg(OAMDATA, 0x11);
    ppu.writeReg(OAMDATA, 0x22);
    ppu.writeReg(OAMDATA, 0x33);

    // Reset address and read back
    ppu.writeReg(OAMADDL, 0x20);
    ppu.writeReg(OAMADDH, 0x00);
    expect(ppu.readReg(OAMREAD)).toBe(0x11);
    expect(ppu.readReg(OAMREAD)).toBe(0x22);
    expect(ppu.readReg(OAMREAD)).toBe(0x33);
  });

  it('high address bits (0..3) via $2103 map into addr 0x100/0x200/0x300 region', () => {
    const ppu = new TimingPPU(); ppu.reset();
    // Set to 0x100 exactly (low=0, high=1)
    ppu.writeReg(OAMADDL, 0x00);
    ppu.writeReg(OAMADDH, 0x01);
    ppu.writeReg(OAMDATA, 0x7A);

    // Read back
    ppu.writeReg(OAMADDL, 0x00);
    ppu.writeReg(OAMADDH, 0x01);
    expect(ppu.readReg(OAMREAD)).toBe(0x7A);
  });
});

