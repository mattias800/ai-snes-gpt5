import { describe, it, expect } from 'vitest';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';

// Registers
const VMAIN = 0x15; const VMADDL = 0x16; const VMADDH = 0x17; const VMDATAL = 0x18; const VMDATAH = 0x19;
const BG2SC = 0x08; const BG12NBA = 0x0b; const TM = 0x2c; const BG2HOFS = 0x0f;
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

describe('PPU timing: BG2 64× screen width mapping', () => {
  it('reads second screen at +0x400 when tileX>=32 (width64)', () => {
    const ppu = new TimingPPU(); ppu.reset();
    ppu.writeReg(TM, 0x02); // enable BG2 only
    ppu.writeReg(VMAIN, 0x00);
    // BG2 map base 0x0000, size=01 (64x32)
    ppu.writeReg(BG2SC, 0x01);
    // BG2 char base low nibble=1 -> 0x0800 words
    ppu.writeReg(BG12NBA, 0x01);

    const charBase = 0x0800;
    writeSolid4bppTile(ppu, charBase, 1, 1); // red
    writeSolid4bppTile(ppu, charBase, 2, 2); // green

    // Tilemap (31,0)=tile1, (32,0)=tile2 at +0x400
    setVAddr(ppu, 0x001f); wWord(ppu, 0x0001);
    setVAddr(ppu, 0x0400); wWord(ppu, 0x0002);

    setCGRAM(ppu, 1, 0x7c00); // red
    setCGRAM(ppu, 2, 0x03e0); // green

    // Scroll to 31*8 so that next dot crosses into second screen
    ppu.writeReg(BG2HOFS, 0xf8); ppu.writeReg(BG2HOFS, 0x00);

    // First 8 dots should be tile1 (red)
    const colors: number[] = [];
    for (let d=0; d<8; d++) { colors.push(ppu.getPixelRGB15()); ppu.stepDot(); }
    // Next dot should be tile2 (green) when moving into tileX=32 region
    colors.push(ppu.getPixelRGB15());

    for (let i=0;i<8;i++) expect(colors[i]).toBe(0x7c00);
    expect(colors[8]).toBe(0x03e0);
  });
});

