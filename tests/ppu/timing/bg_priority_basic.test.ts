import { describe, it, expect } from 'vitest';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';

// Registers
const VMAIN = 0x15; const VMADDL = 0x16; const VMADDH = 0x17; const VMDATAL = 0x18; const VMDATAH = 0x19;
const BG1SC = 0x07; const BG2SC = 0x08; const BG12NBA = 0x0b; const TM = 0x2c; const BGMODE = 0x05;
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

describe('PPU timing: Tile priority between BG1 and BG2', () => {
  it('BG2 high-priority tile shows over BG1 low-priority tile; ties resolved by layer order', () => {
    const p = new TimingPPU(); p.reset();
    p.writeReg(TM, 0x03); // enable BG1 and BG2
    p.writeReg(VMAIN, 0x00);
    // Place BG1 map at 0x0000 and BG2 map at 0x0800 words to avoid overlap
    p.writeReg(BG1SC, 0x00);
    p.writeReg(BG2SC, 0x10); // (0x10 & 0xFC)<<7 = 0x0800 words
    // BG1 char base high nibble=3 (0x1800); BG2 low nibble=4 (0x2000)
    p.writeReg(BG12NBA, 0x34);

    const bg1Char = 0x1800; const bg2Char = 0x2000;
    writeSolid4bppTile(p, bg1Char, 1, 1); // red
    writeSolid4bppTile(p, bg2Char, 2, 2); // green

    // Scenario A: BG1 prio=0, BG2 prio=1 -> should see BG2 (green)
    setVAddr(p, 0x0000); wWord(p, 0x0001);      // BG1 map entry at 0x0000: tile=1, prio=0
    setVAddr(p, 0x0800); wWord(p, 0x2002);      // BG2 map entry at 0x0800: tile=2, prio=1

    setCGRAM(p, 1, 0x7c00); // red
    setCGRAM(p, 2, 0x03e0); // green

    expect(p.getPixelRGB15()).toBe(0x03e0);

    // Scenario B: BG1 prio=1, BG2 prio=1 -> tie; BG1 should win (red)
    setVAddr(p, 0x0000); wWord(p, 0x2001);      // BG1 prio=1
    setVAddr(p, 0x0800); wWord(p, 0x2002);      // BG2 prio=1

    expect(p.getPixelRGB15()).toBe(0x7c00);

    // Scenario C: BG1 prio=0, BG2 prio=0 -> tie; BG1 should win (red)
    setVAddr(p, 0x0000); wWord(p, 0x0001);
    setVAddr(p, 0x0800); wWord(p, 0x0002);

    expect(p.getPixelRGB15()).toBe(0x7c00);
  });
});

