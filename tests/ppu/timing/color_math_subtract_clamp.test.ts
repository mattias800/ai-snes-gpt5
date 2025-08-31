import { describe, it, expect } from 'vitest';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';

// Registers
const VMAIN = 0x15; const VMADDL = 0x16; const VMADDH = 0x17; const VMDATAL = 0x18; const VMDATAH = 0x19;
const BG1SC = 0x07; const BG12NBA = 0x0b; const TM = 0x2c; const CGADSUB = 0x31; const COLDATA = 0x32;
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

describe('PPU timing: color math subtract clamp with fixed color', () => {
  it('subtracts fixed color and clamps to 0', () => {
    const p = new TimingPPU(); p.reset();
    p.writeReg(TM, 0x01); // main: BG1 only
    p.writeReg(VMAIN, 0x00);

    // BG1 map base 0x0000
    p.writeReg(BG1SC, 0x00);
    // BG1 char base high nibble=1 -> 0x0800
    p.writeReg(BG12NBA, 0x10);

    const bg1Char = 0x0800;
    writeSolid4bppTile(p, bg1Char, 2, 2); // green

    // Map (0,0) entry: tile 2
    setVAddr(p, 0x0000); wWord(p, 0x0002);

    // Colors: palette index 2 = green
    setCGRAM(p, 2, 0x03e0); // green

    // Set fixed green = 31 via COLDATA (select G with bit6)
    p.writeReg(COLDATA, 0x40 | 31);

    // CGADSUB: apply to BG1 (bit0), use fixed (bit5), subtract (bit6), no half
    p.writeReg(CGADSUB, 0x61);

    // Expected: green - green = 0
    expect(p.getPixelRGB15()).toBe(0x0000);
  });
});

