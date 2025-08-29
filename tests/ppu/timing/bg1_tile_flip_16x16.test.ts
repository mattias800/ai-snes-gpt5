import { describe, it, expect } from 'vitest';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';

// Registers
const VMAIN = 0x15; const VMADDL = 0x16; const VMADDH = 0x17; const VMDATAL = 0x18; const VMDATAH = 0x19;
const BG1SC = 0x07; const BG12NBA = 0x0b; const TM = 0x2c; const BGMODE = 0x05;
const CGADD = 0x21; const CGDATA = 0x22;

function setVAddr(ppu: TimingPPU, addr: number) { ppu.writeReg(VMADDL, addr & 0xff); ppu.writeReg(VMADDH, (addr>>>8)&0xff); }
function wWord(ppu: TimingPPU, w: number) { ppu.writeReg(VMDATAL, w & 0xff); ppu.writeReg(VMDATAH, (w>>>8)&0xff); }

function writeSolid4bppTile(ppu: TimingPPU, charBaseWord: number, tileIndex: number, colorVal: number) {
  const p0 = (colorVal & 1) ? 0xff : 0x00;
  const p1 = (colorVal & 2) ? 0xff : 0x00;
  const p2 = (colorVal & 4) ? 0xff : 0x00;
  const p3 = (colorVal & 8) ? 0xff : 0x00;
  const tileBase = charBaseWord + tileIndex * 16;
  for (let y=0;y<8;y++) { setVAddr(ppu, tileBase + y); ppu.writeReg(VMDATAL, p0); ppu.writeReg(VMDATAH, p1); }
  for (let y=0;y<8;y++) { setVAddr(ppu, tileBase + 8 + y); ppu.writeReg(VMDATAL, p2); ppu.writeReg(VMDATAH, p3); }
}

function setCGRAM(ppu: TimingPPU, index: number, bgr15: number) {
  ppu.writeReg(CGADD, (index*2) & 0xff);
  ppu.writeReg(CGDATA, bgr15 & 0xff);
  ppu.writeReg(CGDATA, (bgr15>>>8) & 0xff);
}

describe('PPU timing: BG1 16x16 tile flips', () => {
  it('horizontal and vertical flip swap subtiles as expected', () => {
    const ppu = new TimingPPU(); ppu.reset();
    ppu.writeReg(TM, 0x01);
    ppu.writeReg(VMAIN, 0x00);
    ppu.writeReg(BG1SC, 0x00);
    ppu.writeReg(BG12NBA, 0x10); // BG1 char base high nibble=1 -> 0x0800 words
    ppu.writeReg(BGMODE, 0x10);  // 16x16

    const charBase = 0x0800;
    // Four subtiles with palette indices 1..4 at (0,0),(1,0),(0,1),(1,1)
    writeSolid4bppTile(ppu, charBase, 0, 1);
    writeSolid4bppTile(ppu, charBase, 1, 2);
    writeSolid4bppTile(ppu, charBase, 16, 3);
    writeSolid4bppTile(ppu, charBase, 17, 4);

    // Base entry no flips
    setVAddr(ppu, 0x0000); wWord(ppu, 0x0000);

    setCGRAM(ppu, 1, 0x7c00); // red
    setCGRAM(ppu, 2, 0x03e0); // green
    setCGRAM(ppu, 3, 0x001f); // blue
    setCGRAM(ppu, 4, 0x7fff); // white

    const sampleAt = (entryWord: number, x: number, y: number): number => {
      const p = new TimingPPU(); p.reset();
      p.writeReg(TM, 0x01); p.writeReg(VMAIN, 0x00); p.writeReg(BG1SC, 0x00); p.writeReg(BG12NBA, 0x10); p.writeReg(BGMODE, 0x10);
      writeSolid4bppTile(p, charBase, 0, 1); writeSolid4bppTile(p, charBase, 1, 2); writeSolid4bppTile(p, charBase, 16, 3); writeSolid4bppTile(p, charBase, 17, 4);
      setVAddr(p, 0x0000); wWord(p, entryWord);
      setCGRAM(p, 1, 0x7c00); setCGRAM(p, 2, 0x03e0); setCGRAM(p, 3, 0x001f); setCGRAM(p, 4, 0x7fff);
      for (let sl=0; sl<y; sl++) p.stepScanline(); for (let d=0; d<x; d++) p.stepDot(); return p.getPixelRGB15();
    };

    // No flip: (4,4)=red, (12,4)=green, (4,12)=blue, (12,12)=white
    expect(sampleAt(0x0000, 4,4)).toBe(0x7c00);
    expect(sampleAt(0x0000,12,4)).toBe(0x03e0);
    expect(sampleAt(0x0000, 4,12)).toBe(0x001f);
    expect(sampleAt(0x0000,12,12)).toBe(0x7fff);

    // H flip: swap left/right subtiles
    const H = 0x4000;
    expect(sampleAt(H, 4,4)).toBe(0x03e0);
    expect(sampleAt(H,12,4)).toBe(0x7c00);
    expect(sampleAt(H, 4,12)).toBe(0x7fff);
    expect(sampleAt(H,12,12)).toBe(0x001f);

    // V flip: swap top/bottom subtiles
    const V = 0x8000;
    expect(sampleAt(V, 4,4)).toBe(0x001f);
    expect(sampleAt(V,12,4)).toBe(0x7fff);
    expect(sampleAt(V, 4,12)).toBe(0x7c00);
    expect(sampleAt(V,12,12)).toBe(0x03e0);

    // Both flips: rotate 180
    const HV = 0xC000;
    expect(sampleAt(HV, 4,4)).toBe(0x7fff);
    expect(sampleAt(HV,12,4)).toBe(0x001f);
    expect(sampleAt(HV, 4,12)).toBe(0x03e0);
    expect(sampleAt(HV,12,12)).toBe(0x7c00);
  });
});

