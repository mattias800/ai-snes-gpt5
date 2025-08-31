import { describe, it, expect } from 'vitest';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';

// Registers
const VMAIN = 0x15; const VMADDL = 0x16; const VMADDH = 0x17; const VMDATAL = 0x18; const VMDATAH = 0x19;
const BG1SC = 0x07; const BG2SC = 0x08; const BG12NBA = 0x0b; const TM = 0x2c; const TS = 0x2d; const CGADSUB = 0x31;
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

describe('PPU timing: color math add half (main BG1 + sub BG2)', () => {
  it('half-adds main and sub colors when CGADSUB half is set', () => {
    const p = new TimingPPU(); p.reset();
    p.writeReg(TM, 0x01); // main: BG1
    p.writeReg(TS, 0x02); // sub: BG2
    p.writeReg(VMAIN, 0x00);

    // Separate map bases to avoid overwriting
    p.writeReg(BG1SC, 0x00);     // map base 0x0000
    p.writeReg(BG2SC, 0x10);     // (0x10 & 0xFC)<<7 = 0x0800 words

    // BG1 char base high nibble=1 -> 0x0800; BG2 low nibble=2 -> 0x1000
    p.writeReg(BG12NBA, 0x12);

    const bg1Char = 0x0800; const bg2Char = 0x1000;
    writeSolid4bppTile(p, bg1Char, 1, 1); // red
    writeSolid4bppTile(p, bg2Char, 2, 2); // green

    // Map (0,0) entries
    setVAddr(p, 0x0000); wWord(p, 0x0001); // BG1 -> tile 1
    setVAddr(p, 0x0800); wWord(p, 0x0002); // BG2 -> tile 2

    // Colors
    setCGRAM(p, 1, 0x7c00); // red
    setCGRAM(p, 2, 0x03e0); // green

    // CGADSUB: apply to BG1 (bit0), half (bit7=1), add (bit6=0)
    p.writeReg(CGADSUB, 0x81);

    // Expected: (red + green)/2 = (R=31,G=31,B=0)/2 -> (15,15,0) => 0x3DE0
    expect(p.getPixelRGB15()).toBe(0x3DE0);
  });
});

