import { describe, it, expect } from 'vitest';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';

// Registers
const VMAIN = 0x15; const VMADDL = 0x16; const VMADDH = 0x17; const VMDATAL = 0x18; const VMDATAH = 0x19;
const BG2SC = 0x08; const BG12NBA = 0x0b; const TM = 0x2c; const CGADSUB = 0x31; const COLDATA = 0x32;
const W12SEL = 0x23; const WH0 = 0x26; const WH1 = 0x27;
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

describe('PPU timing: BG2 color math window (W12SEL/WH0/WH1)', () => {
  it('applies color math only inside the BG2 window1 region', () => {
    const p = new TimingPPU(); p.reset();
    p.writeReg(TM, 0x02); // main: BG2 only
    p.writeReg(VMAIN, 0x00);

    // BG2 map base 0x0000, BG2 char base low nibble=1 -> 0x0800
    p.writeReg(BG2SC, 0x00);
    p.writeReg(BG12NBA, 0x01);

    const bg2Char = 0x0800;
    writeSolid4bppTile(p, bg2Char, 1, 1); // red

    // Map row: fill tiles 0..31 with tile 1 so the whole row is red
    for (let i=0;i<32;i++) { setVAddr(p, 0x0000 + i); wWord(p, 0x0001); }

    // Colors
    setCGRAM(p, 1, 0x7c00); // red

    // Fixed blue=31 via COLDATA
    p.writeReg(COLDATA, 0x20 | 31);

    // CGADSUB: target BG2 (bit1), use fixed (bit5), half add (bit7)
    p.writeReg(CGADSUB, 0xA2);

    // Window: enable BG2 W1 (bit4), not inverted (bit5=0), WH0=0, WH1=127 (left half)
    p.writeReg(W12SEL, 0x10);
    p.writeReg(WH0, 0x00);
    p.writeReg(WH1, 0x7F);

    // Helper to sample at x
    const sampleAtX = (x: number) => {
      const pp = new TimingPPU(); pp.reset();
      // Re-create state
      pp.writeReg(TM, 0x02); pp.writeReg(VMAIN, 0x00); pp.writeReg(BG2SC, 0x00); pp.writeReg(BG12NBA, 0x01);
      writeSolid4bppTile(pp, bg2Char, 1, 1);
      for (let i=0;i<32;i++) { setVAddr(pp, 0x0000 + i); wWord(pp, 0x0001); }
      setCGRAM(pp, 1, 0x7c00);
      pp.writeReg(COLDATA, 0x20 | 31);
      pp.writeReg(CGADSUB, 0xA2);
      pp.writeReg(W12SEL, 0x10); pp.writeReg(WH0, 0x00); pp.writeReg(WH1, 0x7F);
      for (let d=0; d<x; d++) pp.stepDot();
      return pp.getPixelRGB15();
    };

    // Inside window (x=64) -> blended (red + blue)/2 = 0x3C0F
    expect(sampleAtX(64)).toBe(0x3C0F);
    // Outside window (x=200) -> unchanged red 0x7c00
    expect(sampleAtX(200)).toBe(0x7c00);
  });
});

