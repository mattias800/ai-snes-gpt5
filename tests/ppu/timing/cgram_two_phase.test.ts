import { describe, it, expect } from 'vitest';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';

const CGADD = 0x21; // $2121
const CGDATA = 0x22; // $2122
const CGREAD = 0x3b; // $213B

describe('PPU timing: CGRAM $2121/$2122/$213B basic behavior', () => {
  it('writes increment address and reads increment address', () => {
    const ppu = new TimingPPU(); ppu.reset();
    // Set CGADD to 0x10 and write two bytes
    ppu.writeReg(CGADD, 0x10);
    ppu.writeReg(CGDATA, 0xAA);
    ppu.writeReg(CGDATA, 0xBB);

    // Read back via $213B with auto-increment
    ppu.writeReg(CGADD, 0x10);
    const r1 = ppu.readReg(CGREAD); // 0xAA
    const r2 = ppu.readReg(CGREAD); // 0xBB
    expect(r1).toBe(0xAA);
    expect(r2).toBe(0xBB);
  });

  it('wraps within 0x200 bytes (0..0x1FF)', () => {
    const ppu = new TimingPPU(); ppu.reset();
    ppu.writeReg(CGADD, 0xFF);
    ppu.writeReg(CGDATA, 0x11); // at 0x00FF
    ppu.writeReg(CGDATA, 0x22); // at 0x0100
    ppu.writeReg(CGDATA, 0x33); // at 0x0101

    ppu.writeReg(CGADD, 0xFF);
    expect(ppu.readReg(CGREAD)).toBe(0x11);
    expect(ppu.readReg(CGREAD)).toBe(0x22);
    expect(ppu.readReg(CGREAD)).toBe(0x33);
  });
});

