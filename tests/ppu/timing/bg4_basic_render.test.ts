import { describe, it, expect } from 'vitest';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';

// Registers
const VMAIN = 0x15; const VMADDL = 0x16; const VMADDH = 0x17; const VMDATAL = 0x18; const VMDATAH = 0x19;
const BG4SC = 0x0a; const BG34NBA = 0x0c; const TM = 0x2c; const BG4HOFS = 0x13;
const CGADD = 0x21; const CGDATA = 0x22;

function setVAddr(ppu: TimingPPU, addr: number) { ppu.writeReg(VMADDL, addr & 0xff); ppu.writeReg(VMADDH, (addr>>>8)&0xff); }
function wWord(ppu: TimingPPU, w: number) { ppu.writeReg(VMDATAL, w & 0xff); ppu.writeReg(VMDATAH, (w>>>8)&0xff); }

function writeSolid4bppTile(ppu: TimingPPU, charBaseWord: number, tileIndex: number, value: 1|2) {
  const tileBase = charBaseWord + tileIndex * 16;
  for (let y=0;y<8;y++) {
    setVAddr(ppu, tileBase + y);
    const p0 = (value===1)?0xff:0x00;
    const p1 = (value===2)?0xff:0x00;
    ppu.writeReg(VMDATAL, p0); ppu.writeReg(VMDATAH, p1);
  }
  for (let y=0;y<8;y++) { setVAddr(ppu, tileBase + 8 + y); ppu.writeReg(VMDATAL, 0x00); ppu.writeReg(VMDATAH, 0x00); }
}

function setCGRAM(ppu: TimingPPU, index: number, bgr15: number) {
  ppu.writeReg(CGADD, (index*2) & 0xff);
  ppu.writeReg(CGDATA, bgr15 & 0xff);
  ppu.writeReg(CGDATA, (bgr15>>>8) & 0xff);
}

describe('PPU timing: BG4 basic render', () => {
  it('renders BG4 when enabled via TM bit3 and uses BG34NBA low nibble', () => {
    const ppu = new TimingPPU(); ppu.reset();
    ppu.writeReg(TM, 0x08); // enable BG4 only
    ppu.writeReg(VMAIN, 0x00);
    ppu.writeReg(BG4SC, 0x00); // map base 0x0000, 32x32
    ppu.writeReg(BG34NBA, 0x01); // BG4 char base low nibble=1 -> 0x0800 words

    const charBase = 0x0800;
    writeSolid4bppTile(ppu, charBase, 1, 1); // red

    // Map (0,0) -> tile 1
    setVAddr(ppu, 0x0000); wWord(ppu, 0x0001);

    // Set palette 1 to red
    setCGRAM(ppu, 1, 0x7c00);

    // Pixel at (0,0) should be red
    expect(ppu.getPixelRGB15()).toBe(0x7c00);
  });
});

