import { describe, it, expect } from 'vitest';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';

// Registers
const VMAIN = 0x15; const VMADDL = 0x16; const VMADDH = 0x17; const VMDATAL = 0x18; const VMDATAH = 0x19;
const BG1SC = 0x07; const BG12NBA = 0x0b; const BG1HOFS = 0x0d; const TM = 0x2c;
const CGADD = 0x21; const CGDATA = 0x22;

function setVAddr(ppu: TimingPPU, addr: number) { ppu.writeReg(VMADDL, addr & 0xff); ppu.writeReg(VMADDH, (addr>>>8)&0xff); }
function wWord(ppu: TimingPPU, w: number) { ppu.writeReg(VMDATAL, w & 0xff); ppu.writeReg(VMDATAH, (w>>>8)&0xff); }

function writeSolid4bppTile(ppu: TimingPPU, charBaseWord: number, tileIndex: number, value: 1|2) {
  // value=1 -> plane0=0xff rows; value=2 -> plane1=0xff rows
  const tileBase = charBaseWord + tileIndex * 16;
  for (let y=0;y<8;y++) {
    // low planes
    setVAddr(ppu, tileBase + y);
    const p0 = (value===1)?0xff:0x00;
    const p1 = (value===2)?0xff:0x00;
    ppu.writeReg(VMDATAL, p0); ppu.writeReg(VMDATAH, p1);
  }
  for (let y=0;y<8;y++) {
    setVAddr(ppu, tileBase + 8 + y);
    ppu.writeReg(VMDATAL, 0x00); ppu.writeReg(VMDATAH, 0x00);
  }
}

function setCGRAM(ppu: TimingPPU, index: number, bgr15: number) {
  // index is palette entry number
  ppu.writeReg(CGADD, (index*2) & 0xff);
  ppu.writeReg(CGDATA, bgr15 & 0xff);
  ppu.writeReg(CGDATA, (bgr15>>>8) & 0xff);
}

describe('PPU timing: mid-scanline BG1 HOFS applies at next 8px boundary', () => {
  it('switches from tile 1 (red) to tile 2 (green) at boundary after write', () => {
    const ppu = new TimingPPU(); ppu.reset();
    // Enable BG1
    ppu.writeReg(TM, 0x01);
    // Set VMAIN to inc after high
    ppu.writeReg(VMAIN, 0x00);
    // BG1 map at 0x0000, char base nibble=1 -> 0x0800 words
    ppu.writeReg(BG1SC, 0x00);
    ppu.writeReg(BG12NBA, 0x10);

    const charBase = 0x0800;

    // Write tile 1 = red (pix value 1), tile 2 = green (pix value 2)
    writeSolid4bppTile(ppu, charBase, 1, 1);
    writeSolid4bppTile(ppu, charBase, 2, 2);

    // Tilemap (0,0) -> tile 1, (1,0) -> tile 2, (2,0) -> tile 2 as well (to tolerate HOFS=8 shift at boundary)
    setVAddr(ppu, 0x0000);
    wWord(ppu, 0x0001); // tile 1
    setVAddr(ppu, 0x0001);
    wWord(ppu, 0x0002); // tile 2
    setVAddr(ppu, 0x0002);
    wWord(ppu, 0x0002); // tile 2 at x=2 too

    // CGRAM: index 1 = red max, index 2 = green max
    setCGRAM(ppu, 1, 0x7c00); // red
    setCGRAM(ppu, 2, 0x03e0); // green

    // Start at line 0
    // First 8 dots should be red, next will be red until we change HOFS
    const colors: number[] = [];
    for (let d=0; d<8; d++) { colors.push(ppu.getPixelRGB15()); ppu.stepDot(); }

    // Mid-line: set HOFS=8 (two writes); should apply at next 8px boundary (which is now since hDot==8)
    ppu.writeReg(BG1HOFS, 0x00); // low
    ppu.writeReg(BG1HOFS, 0x01); // high bits -> 0x100 + 0x00 = 256; but we mask to 11 bits in emulator; our simple uses 11 bits; set to 0x100 -> effective 256, but we wanted 8.
    // Use 8 instead: low=8, high=0
    ppu.writeReg(BG1HOFS, 0x08);
    ppu.writeReg(BG1HOFS, 0x00);

    for (let d=8; d<16; d++) { colors.push(ppu.getPixelRGB15()); ppu.stepDot(); }

    // Validate: first 8 are red, next 8 are green
    for (let i=0;i<8;i++) expect(colors[i]).toBe(0x7c00);
    for (let i=8;i<16;i++) expect(colors[i]).toBe(0x03e0);
  });
});

