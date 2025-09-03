import { describe, it, expect } from 'vitest';
import { Emulator } from '../../src/emulator/core';
import { Scheduler } from '../../src/emulator/scheduler';
import { Cartridge } from '../../src/cart/cartridge';
import { renderBG4bppTilemapIndices } from '../../src/ppu/bg';

// Build a ROM program that writes a single 4bpp tile and a 2x2 tilemap via PPU ports, then BRK.
// Uses only LDA #imm (A) and STA abs which are implemented, no loops.

function pushByte(prog: number[], b: number) { prog.push(b & 0xff); }
function ldaImm(prog: number[], v: number) { pushByte(prog, 0xa9); pushByte(prog, v); }
function staAbs(prog: number[], addr: number) {
  pushByte(prog, 0x8d); pushByte(prog, addr & 0xff); pushByte(prog, (addr >>> 8) & 0xff);
}

function buildProgram(): Uint8Array {
  const p: number[] = [];
  // Set VMAIN = 0x80 (inc after high, step +1 word)
  ldaImm(p, 0x80); staAbs(p, 0x2115);

  // Write tile planes at tileBase=0x0100 words
  const tileBaseWord = 0x0100;
  for (let y = 0; y < 8; y++) {
    // Set VADDR = tileBase+y (word)
    ldaImm(p, (tileBaseWord + y) & 0xff); staAbs(p, 0x2116);
    ldaImm(p, ((tileBaseWord + y) >>> 8) & 0xff); staAbs(p, 0x2117);
    // VMDATAL = 0xAA; VMDATAH = 0x00
    ldaImm(p, 0xaa); staAbs(p, 0x2118);
    ldaImm(p, 0x00); staAbs(p, 0x2119);

    // High planes at tileBase+8+y
    ldaImm(p, (tileBaseWord + 8 + y) & 0xff); staAbs(p, 0x2116);
    ldaImm(p, ((tileBaseWord + 8 + y) >>> 8) & 0xff); staAbs(p, 0x2117);
    ldaImm(p, 0x00); staAbs(p, 0x2118);
    ldaImm(p, 0x00); staAbs(p, 0x2119);
  }

  // Write tilemap at mapBase=0x0000 words: entries (0,0)->pal0, (1,0)->pal1, (0,1)->pal2|Xflip, (1,1)->pal3|Yflip
  function writeMapEntry(offsetWords: number, value: number) {
    ldaImm(p, (0x0000 + offsetWords) & 0xff); staAbs(p, 0x2116);
    ldaImm(p, ((0x0000 + offsetWords) >>> 8) & 0xff); staAbs(p, 0x2117);
    ldaImm(p, value & 0xff); staAbs(p, 0x2118);
    ldaImm(p, (value >>> 8) & 0xff); staAbs(p, 0x2119);
  }
  const pal = (g: number) => (g & 7) << 10;
  writeMapEntry(0, pal(0) | 0);           // (0,0)
  writeMapEntry(1, pal(1) | 0);           // (1,0)
  writeMapEntry(32, pal(2) | 0x4000);     // (0,1) X flip
  writeMapEntry(33, pal(3) | 0x8000);     // (1,1) Y flip

  // BRK to end
  pushByte(p, 0x00);
  return new Uint8Array(p);
}

function makeCart(): Cartridge {
  const bank = new Uint8Array(0x8000);
  const prog = buildProgram();
  bank.set(prog, 0); // place at $8000
  const rom = new Uint8Array(0x20000); // 128KiB
  rom.set(bank, 0);
  // Reset vector -> $8000
  rom[0x7ffc] = 0x00; rom[0x7ffd] = 0x80;
  return new Cartridge({ rom, mapping: 'lorom' });
}

describe('Frame-level BG indices via CPU-written VRAM', () => {
  it('program writes tile and tilemap; frame render yields expected palette indices', () => {
    const cart = makeCart();
    const emu = Emulator.fromCartridge(cart);
    emu.reset();

    // Run one frame to execute program under scheduler
    const sched = new Scheduler(emu, 200);
    sched.stepFrame();

    // Decode 2x2 tiles (16x16 px) from mapBase=0x0000 and tileBase=0x0100
    const ppu = emu.bus.getPPU();
    const indices = renderBG4bppTilemapIndices(ppu, 0x0000, 0x0100, 2, 2);
    const W = 16;
    // Same assertions as earlier BG test
    expect(indices[0]).toBe(1);
    expect(indices[8]).toBe(17);
    expect(indices[8 * W + 0]).toBe(32);
    expect(indices[8 * W + 8]).toBe(49);
  });
});

