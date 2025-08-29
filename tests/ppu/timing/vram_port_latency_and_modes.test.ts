import { describe, it, expect } from 'vitest';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';

const VMAIN = 0x15; // $2115
const VMADDL = 0x16; // $2116
const VMADDH = 0x17; // $2117
const VMDATAL = 0x18; // $2118
const VMDATAH = 0x19; // $2119
const VMDATARL = 0x39; // $2139
const VMDATARH = 0x3a; // $213A

function setVAddr(ppu: TimingPPU, addr: number) {
  ppu.writeReg(VMADDL, addr & 0xff);
  ppu.writeReg(VMADDH, (addr >>> 8) & 0xff);
}

function writeWord(ppu: TimingPPU, word: number) {
  ppu.writeReg(VMDATAL, word & 0xff);
  ppu.writeReg(VMDATAH, (word >>> 8) & 0xff);
}

function readWord(ppu: TimingPPU): number {
  const lo = ppu.readReg(VMDATARL) & 0xff;
  const hi = ppu.readReg(VMDATARH) & 0xff;
  return ((hi << 8) | lo) & 0xffff;
}

describe('PPU timing: VRAM port increment modes and after-low/high behavior', () => {
  it('inc after high (bit7=0), step=+1', () => {
    const ppu = new TimingPPU(); ppu.reset();
    ppu.writeReg(VMAIN, 0x00); // bit7=0 -> inc after high, stepSel=0 -> +1
    setVAddr(ppu, 0x1234);
    writeWord(ppu, 0xBEEF);
    // After high write, vaddr increments to 0x1235
    writeWord(ppu, 0xCAFE);

    // Read back from 0x1234
    setVAddr(ppu, 0x1234);
    const w1 = readWord(ppu);
    const w2 = readWord(ppu);
    expect(w1).toBe(0xBEEF);
    expect(w2).toBe(0xCAFE);
  });

  it('inc after low (bit7=1), step=+1', () => {
    const ppu = new TimingPPU(); ppu.reset();
    ppu.writeReg(VMAIN, 0x80); // bit7=1 -> inc after low, stepSel=0 -> +1
    setVAddr(ppu, 0x2000);
    // Write two words; after each low write, address increments
    ppu.writeReg(VMDATAL, 0xEF); // write low to 0x2000 -> inc to 0x2001
    ppu.writeReg(VMDATAH, 0xBE); // high goes to 0x2000 (word assembled), but addr already 0x2001
    ppu.writeReg(VMDATAL, 0xFE); // low at 0x2001 -> inc to 0x2002
    ppu.writeReg(VMDATAH, 0xCA);

    // Read back: set to 0x2000 and read two words
    setVAddr(ppu, 0x2000);
    ppu.writeReg(VMAIN, 0x80); // ensure same inc mode for reads
    const w1 = readWord(ppu);
    const w2 = readWord(ppu);
    expect(w1).toBe(0xBEEF);
    expect(w2).toBe(0xCAFE);
  });

  it('step sizes +1, +32, +128 (bit7=0 inc after high)', () => {
    const ppu = new TimingPPU(); ppu.reset();
    // step +1
    ppu.writeReg(VMAIN, 0x00);
    setVAddr(ppu, 0x0100);
    writeWord(ppu, 0x1111);
    // step +32
    ppu.writeReg(VMAIN, 0x01);
    writeWord(ppu, 0x2222);
    // step +128 (sel=2)
    ppu.writeReg(VMAIN, 0x02);
    writeWord(ppu, 0x3333);

    // Read back by resetting vaddr each time
    ppu.writeReg(VMAIN, 0x00);
    setVAddr(ppu, 0x0100);
    expect(readWord(ppu)).toBe(0x1111);

    ppu.writeReg(VMAIN, 0x01);
    setVAddr(ppu, 0x0101); // second write landed at 0x0101
    expect(readWord(ppu)).toBe(0x2222);

    ppu.writeReg(VMAIN, 0x02);
    setVAddr(ppu, 0x0121); // third write landed at 0x0121 (after +32 from 0x0101)
    expect(readWord(ppu)).toBe(0x3333);
  });
});

