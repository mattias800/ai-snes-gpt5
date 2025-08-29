import { describe, it, expect } from 'vitest';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';

// Registers
const VMAIN = 0x15; const VMADDL = 0x16; const VMADDH = 0x17; const VMDATAL = 0x18; const VMDATAH = 0x19;
const BG2SC = 0x08; const BG12NBA = 0x0b; const TM = 0x2c; const BGMODE = 0x05;
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

describe('PPU timing: BG2 16x16 tiles per-dot', () => {
  it('samples correct subtile and palette indices across 4 quadrants', () => {
    const ppu = new TimingPPU(); ppu.reset();
    ppu.writeReg(TM, 0x02); // BG2 only
    ppu.writeReg(VMAIN, 0x00);
    ppu.writeReg(BG2SC, 0x00);
    ppu.writeReg(BG12NBA, 0x01); // BG2 char base low nibble=1 -> 0x0800 words
    ppu.writeReg(BGMODE, 0x20); // bit5=1 -> BG2 16x16

    const charBase = 0x0800;
    writeSolid4bppTile(ppu, charBase, 0, 1);
    writeSolid4bppTile(ppu, charBase, 1, 2);
    writeSolid4bppTile(ppu, charBase, 16, 3);
    writeSolid4bppTile(ppu, charBase, 17, 4);

    // Map entry tileIndexBase = 0
    setVAddr(ppu, 0x0000); wWord(ppu, 0x0000);

    setCGRAM(ppu, 1, 0x7c00); // red
    setCGRAM(ppu, 2, 0x03e0); // green
    setCGRAM(ppu, 3, 0x001f); // blue
    setCGRAM(ppu, 4, 0x7fff); // white

    const sampleAt = (sx: number, sy: number): number => {
      ppu.reset();
      for (let sl=0; sl<sy; sl++) ppu.stepScanline();
      for (let d=0; d<sx; d++) ppu.stepDot();
      return ppu.getPixelRGB15();
    };

    expect(sampleAt(4,4)).toBe(0x7c00);
    expect(sampleAt(12,4)).toBe(0x03e0);
    expect(sampleAt(4,12)).toBe(0x001f);
    expect(sampleAt(12,12)).toBe(0x7fff);
  });
});

