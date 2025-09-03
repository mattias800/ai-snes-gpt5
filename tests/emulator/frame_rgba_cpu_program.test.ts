import { describe, it, expect } from 'vitest';
import { Emulator } from '../../src/emulator/core';
import { Scheduler } from '../../src/emulator/scheduler';
import { Cartridge } from '../../src/cart/cartridge';
import { renderMainScreenRGBA } from '../../src/ppu/bg';

function pushByte(prog: number[], b: number) { prog.push(b & 0xff); }
function ldaImm(prog: number[], v: number) { pushByte(prog, 0xa9); pushByte(prog, v); }
function staAbs(prog: number[], addr: number) {
  pushByte(prog, 0x8d); pushByte(prog, addr & 0xff); pushByte(prog, (addr >>> 8) & 0xff);
}

function buildProgram(): Uint8Array {
  const p: number[] = [];
  // Unblank, full brightness (INIDISP $2100 = 0x0F)
  ldaImm(p, 0x0f); staAbs(p, 0x2100);
  // Enable BG1 on main screen (TM $212C = 0x01)
  ldaImm(p, 0x01); staAbs(p, 0x212c);
  // BGMODE ($2105) = 0x01 (mode 1: BG1/2 are 4bpp, BG3 is 2bpp)
  ldaImm(p, 0x01); staAbs(p, 0x2105);
  // BG1SC ($2107) = 0x00 (map base 0x0000, 32x32)
  ldaImm(p, 0x00); staAbs(p, 0x2107);
  // BG12NBA ($210B) = 0x02 (BG1 char base nibble=2 -> char base 0x1000 words)
  ldaImm(p, 0x02); staAbs(p, 0x210b);
  // VMAIN ($2115) = 0x80 (inc after HIGH, +1 word)
  ldaImm(p, 0x80); staAbs(p, 0x2115);

  // Write 4bpp tile 1 at char base: solid palette index 1 (tile index 1 to keep tile 0 blank)
  const tileBaseWord = 0x1000;
  const tile1WordBase = tileBaseWord + 16; // 16 words per 4bpp tile
  for (let y = 0; y < 8; y++) {
    // VMADD = tile1WordBase + y (word)
    ldaImm(p, (tile1WordBase + y) & 0xff); staAbs(p, 0x2116);
    ldaImm(p, ((tile1WordBase + y) >>> 8) & 0xff); staAbs(p, 0x2117);
    // VMDATAL/L/H: low word bytes -> low0=0xFF, low1=0x00
    ldaImm(p, 0xff); staAbs(p, 0x2118);
    ldaImm(p, 0x00); staAbs(p, 0x2119);
  }
  for (let y = 0; y < 8; y++) {
    // hi planes at tile1WordBase + 8 + y
    const addr = tile1WordBase + 8 + y;
    ldaImm(p, addr & 0xff); staAbs(p, 0x2116);
    ldaImm(p, (addr >>> 8) & 0xff); staAbs(p, 0x2117);
    ldaImm(p, 0x00); staAbs(p, 0x2118);
    ldaImm(p, 0x00); staAbs(p, 0x2119);
  }

  // Tilemap entry (0,0) at map base 0x0000 -> tile 1, palette group 0
  ldaImm(p, 0x00); staAbs(p, 0x2116);
  ldaImm(p, 0x00); staAbs(p, 0x2117);
  ldaImm(p, 0x01); staAbs(p, 0x2118);
  ldaImm(p, 0x00); staAbs(p, 0x2119);

  // Set CGRAM palette index 1 = red max (BGR555: R=31)
  // CGADD ($2121) takes byte index; word index 1 -> byte index 2
  ldaImm(p, 0x02); staAbs(p, 0x2121);
  ldaImm(p, 0x00); staAbs(p, 0x2122); // low byte
  ldaImm(p, 0x7c); staAbs(p, 0x2122); // high byte: (31<<10)=0x7C00

  // BRK to end program
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
  // IRQ/BRK vector -> $8000 as well so BRK loops back harmlessly
  rom[0x7ffe] = 0x00; rom[0x7fff] = 0x80;
  return new Cartridge({ rom, mapping: 'lorom' });
}

describe('Frame-level main RGBA through CPU program and PPU ports', () => {
  it('renders a red 8x8 tile at top-left over black background', () => {
    const cart = makeCart();
    const emu = Emulator.fromCartridge(cart);
    emu.reset();

    const sched = new Scheduler(emu, 500);
    // One frame is ample for a tiny straight-line program
    sched.stepFrame();

    const ppu = emu.bus.getPPU();
    const W = 16, H = 16;
    const rgba = renderMainScreenRGBA(ppu, W, H);

    // Build expected RGBA: top-left 8x8 red, rest black
    const expected = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        const isRed = (x < 8 && y < 8);
        expected[o + 0] = isRed ? 255 : 0;
        expected[o + 1] = 0;
        expected[o + 2] = 0;
        expected[o + 3] = 255;
      }
    }

    // Compare arrays exactly
    expect(rgba.length).toBe(expected.length);
    for (let i = 0; i < rgba.length; i++) {
      if (rgba[i] !== expected[i]) {
        throw new Error(`RGBA mismatch at index ${i}: got ${rgba[i]}, want ${expected[i]}`);
      }
    }
  });
});
