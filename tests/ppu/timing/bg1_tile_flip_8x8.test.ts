import { describe, it, expect } from 'vitest';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';

// Registers
const VMAIN = 0x15; const VMADDL = 0x16; const VMADDH = 0x17; const VMDATAL = 0x18; const VMDATAH = 0x19;
const BG1SC = 0x07; const BG12NBA = 0x0b; const TM = 0x2c; const BGMODE = 0x05;
const CGADD = 0x21; const CGDATA = 0x22;

function setVAddr(ppu: TimingPPU, addr: number) { ppu.writeReg(VMADDL, addr & 0xff); ppu.writeReg(VMADDH, (addr>>>8)&0xff); }
function wWord(ppu: TimingPPU, w: number) { ppu.writeReg(VMDATAL, w & 0xff); ppu.writeReg(VMDATAH, (w>>>8)&0xff); }

function writeTileColsLeft1Right2(ppu: TimingPPU, charBaseWord: number, tileIndex: number) {
  const base = charBaseWord + tileIndex * 16;
  for (let y=0;y<8;y++) {
    setVAddr(ppu, base + y);
    ppu.writeReg(VMDATAL, 0xF0); // p0: left half=1, right=0
    ppu.writeReg(VMDATAH, 0x0F); // p1: left half=0, right=1 -> values: left=1, right=2
  }
  for (let y=0;y<8;y++) { setVAddr(ppu, base + 8 + y); ppu.writeReg(VMDATAL, 0x00); ppu.writeReg(VMDATAH, 0x00); }
}

function writeTileRowsTop1Bottom2(ppu: TimingPPU, charBaseWord: number, tileIndex: number) {
  const base = charBaseWord + tileIndex * 16;
  for (let y=0;y<4;y++) { setVAddr(ppu, base + y); ppu.writeReg(VMDATAL, 0xFF); ppu.writeReg(VMDATAH, 0x00); }
  for (let y=4;y<8;y++) { setVAddr(ppu, base + y); ppu.writeReg(VMDATAL, 0x00); ppu.writeReg(VMDATAH, 0xFF); }
  for (let y=0;y<8;y++) { setVAddr(ppu, base + 8 + y); ppu.writeReg(VMDATAL, 0x00); ppu.writeReg(VMDATAH, 0x00); }
}

function setCGRAM(ppu: TimingPPU, index: number, bgr15: number) {
  ppu.writeReg(CGADD, (index*2) & 0xff);
  ppu.writeReg(CGDATA, bgr15 & 0xff);
  ppu.writeReg(CGDATA, (bgr15>>>8) & 0xff);
}

describe('PPU timing: BG1 8x8 tile flips', () => {
  it('horizontal flip mirrors left/right within an 8x8 tile', () => {
    const ppu = new TimingPPU(); ppu.reset();
    ppu.writeReg(TM, 0x01);
    ppu.writeReg(VMAIN, 0x00);
    ppu.writeReg(BG1SC, 0x00);
    ppu.writeReg(BG12NBA, 0x10); // BG1 char base high nibble=1 -> 0x0800 words
    ppu.writeReg(BGMODE, 0x00);  // 8x8

    const charBase = 0x0800;
    writeTileColsLeft1Right2(ppu, charBase, 0);

    setVAddr(ppu, 0x0000); wWord(ppu, 0x0000); // tile 0, no flips

    setCGRAM(ppu, 1, 0x7c00); // red
    setCGRAM(ppu, 2, 0x03e0); // green

    // Sample left (x=2) and right (x=6) without flip
    const sample = (x: number, y: number) => { const p = new TimingPPU(); p.reset();
      // copy state quickly by redoing writes
      p.writeReg(TM, 0x01); p.writeReg(VMAIN, 0x00); p.writeReg(BG1SC, 0x00); p.writeReg(BG12NBA, 0x10); p.writeReg(BGMODE, 0x00);
      // copy VRAM and CGRAM by redoing the minimal writes
      writeTileColsLeft1Right2(p, charBase, 0);
      setVAddr(p, 0x0000); wWord(p, 0x0000);
      setCGRAM(p, 1, 0x7c00); setCGRAM(p, 2, 0x03e0);
      for (let sl=0; sl<y; sl++) p.stepScanline(); for (let d=0; d<x; d++) p.stepDot(); return p.getPixelRGB15(); };

    expect(sample(2,0)).toBe(0x7c00); // left -> red
    expect(sample(6,0)).toBe(0x03e0); // right -> green

    // Now set H flip and sample again
    setVAddr(ppu, 0x0000); wWord(ppu, 0x4000); // hflip

    const sampleFlip = (x: number, y: number) => { const p = new TimingPPU(); p.reset();
      p.writeReg(TM, 0x01); p.writeReg(VMAIN, 0x00); p.writeReg(BG1SC, 0x00); p.writeReg(BG12NBA, 0x10); p.writeReg(BGMODE, 0x00);
      writeTileColsLeft1Right2(p, charBase, 0);
      setVAddr(p, 0x0000); wWord(p, 0x4000);
      setCGRAM(p, 1, 0x7c00); setCGRAM(p, 2, 0x03e0);
      for (let sl=0; sl<y; sl++) p.stepScanline(); for (let d=0; d<x; d++) p.stepDot(); return p.getPixelRGB15(); };

    expect(sampleFlip(2,0)).toBe(0x03e0); // left becomes green
    expect(sampleFlip(6,0)).toBe(0x7c00); // right becomes red
  });

  it('vertical flip mirrors top/bottom within an 8x8 tile', () => {
    const ppu = new TimingPPU(); ppu.reset();
    ppu.writeReg(TM, 0x01);
    ppu.writeReg(VMAIN, 0x00);
    ppu.writeReg(BG1SC, 0x00);
    ppu.writeReg(BG12NBA, 0x10);
    ppu.writeReg(BGMODE, 0x00);

    const charBase = 0x0800;
    writeTileRowsTop1Bottom2(ppu, charBase, 1);

    setVAddr(ppu, 0x0000); wWord(ppu, 0x0001); // tile 1, no flips

    setCGRAM(ppu, 1, 0x7c00); // red (top)
    setCGRAM(ppu, 2, 0x03e0); // green (bottom)

    const sample = (x: number, y: number) => { const p = new TimingPPU(); p.reset();
      p.writeReg(TM, 0x01); p.writeReg(VMAIN, 0x00); p.writeReg(BG1SC, 0x00); p.writeReg(BG12NBA, 0x10); p.writeReg(BGMODE, 0x00);
      writeTileRowsTop1Bottom2(p, charBase, 1);
      setVAddr(p, 0x0000); wWord(p, 0x0001);
      setCGRAM(p, 1, 0x7c00); setCGRAM(p, 2, 0x03e0);
      for (let sl=0; sl<y; sl++) p.stepScanline(); for (let d=0; d<x; d++) p.stepDot(); return p.getPixelRGB15(); };

    expect(sample(0,2)).toBe(0x7c00); // top -> red
    expect(sample(0,6)).toBe(0x03e0); // bottom -> green

    // Now set V flip and sample again
    setVAddr(ppu, 0x0000); wWord(ppu, 0x8001); // vflip

    const sampleFlip = (x: number, y: number) => { const p = new TimingPPU(); p.reset();
      p.writeReg(TM, 0x01); p.writeReg(VMAIN, 0x00); p.writeReg(BG1SC, 0x00); p.writeReg(BG12NBA, 0x10); p.writeReg(BGMODE, 0x00);
      writeTileRowsTop1Bottom2(p, charBase, 1);
      setVAddr(p, 0x0000); wWord(p, 0x8001);
      setCGRAM(p, 1, 0x7c00); setCGRAM(p, 2, 0x03e0);
      for (let sl=0; sl<y; sl++) p.stepScanline(); for (let d=0; d<x; d++) p.stepDot(); return p.getPixelRGB15(); };

    expect(sampleFlip(0,2)).toBe(0x03e0); // top becomes green
    expect(sampleFlip(0,6)).toBe(0x7c00); // bottom becomes red
  });
});

