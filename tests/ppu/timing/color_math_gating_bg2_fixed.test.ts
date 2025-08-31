import { describe, it, expect } from 'vitest';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';

// Registers
const VMAIN = 0x15; const VMADDL = 0x16; const VMADDH = 0x17; const VMDATAL = 0x18; const VMDATAH = 0x19;
const BG2SC = 0x08; const BG12NBA = 0x0b; const TM = 0x2c; const CGADSUB = 0x31; const COLDATA = 0x32;
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

describe('PPU timing: CGADSUB gating per-layer (BG2)', () => {
  it('applies color math only when BG2 target bit is set', () => {
    const p = new TimingPPU(); p.reset();
    p.writeReg(TM, 0x02); // main: BG2 only
    p.writeReg(VMAIN, 0x00);

    // BG2 map base 0x0000, BG2 char base low nibble=1 -> 0x0800
    p.writeReg(BG2SC, 0x00);
    p.writeReg(BG12NBA, 0x01);

    const bg2Char = 0x0800;
    writeSolid4bppTile(p, bg2Char, 1, 1); // red

    // Map (0,0)
    setVAddr(p, 0x0000); wWord(p, 0x0001);

    setCGRAM(p, 1, 0x7c00); // red

    // Fixed blue=31
    p.writeReg(COLDATA, 0x20 | 31);

    // CGADSUB: use fixed + half add, but no BG2 gating bit -> expect unchanged red
    p.writeReg(CGADSUB, 0xA0);
    expect(p.getPixelRGB15()).toBe(0x7c00);

    // Now enable BG2 target (bit1)
    p.writeReg(CGADSUB, 0xA2);
    // Expect (red + blue)/2 = (15,0,15) => 0x3C0F
    expect(p.getPixelRGB15()).toBe(0x3C0F);
  });
});

