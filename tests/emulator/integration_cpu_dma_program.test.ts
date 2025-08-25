import { describe, it, expect } from 'vitest';
import { Emulator } from '../../src/emulator/core';
import { Scheduler } from '../../src/emulator/scheduler';
import { Cartridge } from '../../src/cart/cartridge';
import { renderBG1RegionRGBA } from '../../src/ppu/bg';

const MMIO = (addr: number) => 0x000000 | addr;

// Build a small program that sets VMAIN, CGADD, configures two DMA channels:
// ch0: A->B mode1 to $2118/$2119 for 32 bytes (VRAM tile)
// ch1: A->B mode0 to $2122 for 2 bytes (CGRAM color at index 1)
// then triggers MDMAEN.
function buildProgram(): Uint8Array {
  const p: number[] = [];
  const lda = (v: number) => { p.push(0xa9, v & 0xff); };
  const sta = (addr: number) => { p.push(0x8d, addr & 0xff, (addr >>> 8) & 0xff); };

  // VMAIN = 0x00 (inc after high)
  lda(0x00); sta(0x2115);
  // Set VADDR = 0x0000 for VRAM DMA destination
  lda(0x00); sta(0x2116);
  lda(0x00); sta(0x2117);
  // CGADD = 2 (palette index 1)
  lda(0x02); sta(0x2121);

  // DMA ch0 ($430x): DMAP=1, BBAD=$18, A1T=$1100, A1B=0x7E, DAS=32
  lda(0x01); sta(0x4300);
  lda(0x18); sta(0x4301);
  lda(0x00); sta(0x4302); // A1T low
  lda(0x11); sta(0x4303); // A1T high
  lda(0x7e); sta(0x4304); // A1B
  lda(32);   sta(0x4305); // DAS low
  lda(0x00); sta(0x4306); // DAS high

  // DMA ch1 ($431x): DMAP=0, BBAD=$22, A1T=$1200, A1B=0x7E, DAS=2
  lda(0x00); sta(0x4310);
  lda(0x22); sta(0x4311);
  lda(0x00); sta(0x4312);
  lda(0x12); sta(0x4313);
  lda(0x7e); sta(0x4314);
  lda(2);    sta(0x4315);
  lda(0x00); sta(0x4316);

  // Trigger MDMAEN with ch0|ch1 = 0x03
  lda(0x03); sta(0x420b);

  // BRK
  p.push(0x00);
  return new Uint8Array(p);
}

function makeCart(): Cartridge {
  const bank = new Uint8Array(0x8000);
  bank.set(buildProgram(), 0); // at $8000
  const rom = new Uint8Array(0x20000);
  rom.set(bank, 0);
  rom[0x7ffc] = 0x00; rom[0x7ffd] = 0x80; // reset vector
  return new Cartridge({ rom, mapping: 'lorom' });
}

describe('Integration: CPU-configured DMA to VRAM and CGRAM then RGBA render', () => {
  it('loads tile and palette via DMA and renders correct colors', () => {
    const cart = makeCart();
    const emu = Emulator.fromCartridge(cart);
    const bus = emu.bus;
    const ppu = bus.getPPU();

    // Pre-seed WRAM with tile (32 bytes) at 7E:1100 and color (2 bytes) at 7E:1200
    // Tile: for rows 0..7: plane0=0xFF, plane1=0x00 -> pixel value = 1; planes 2/3 = 0
    for (let y = 0; y < 8; y++) {
      const base = 0x1100 + y * 2;
      // bytes 0..15 interleave plane0/plane1 per row
      bus.write8((0x7e << 16) | (base + 0), 0xff); // plane0
      bus.write8((0x7e << 16) | (base + 1), 0x00); // plane1
    }
    for (let i = 16; i < 32; i++) bus.write8((0x7e << 16) | (0x1100 + i), 0x00);
    // Color: palette index 1 = red max (0x7C00 little-endian -> bytes 0x00, 0x7C)
    bus.write8((0x7e << 16) | 0x1200, 0x00);
    bus.write8((0x7e << 16) | 0x1201, 0x7c);

    // Initialize BG1 regs: map base to 0x2000 bytes (0x1000 words), char base 0x0000 words
    bus.write8(MMIO(0x2107), 0x20);
    bus.write8(MMIO(0x210b), 0x00);

    // Initialize tilemap entry at word 0x1000 to tile 0, palette group 0
    bus.write8(MMIO(0x2116), 0x00);
    bus.write8(MMIO(0x2117), 0x10);
    bus.write8(MMIO(0x2118), 0x00); // low
    bus.write8(MMIO(0x2119), 0x00); // high

    emu.reset();

    // Run a frame; scheduler handles BRK by early exit per our implementation
    const sched = new Scheduler(emu, 200);
    sched.stepFrame();

    // Render 16x16 RGBA region; with palette index 1 set to red, pixels should be red
    const rgba = renderBG1RegionRGBA(ppu, 16, 16);
    const px = (x: number, y: number) => {
      const o = (y * 16 + x) * 4;
      return [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]];
    };
    const p = px(0, 0);
    expect(p[0]).toBe(255); // red
    expect(p[1]).toBe(0);
    expect(p[2]).toBe(0);
    expect(p[3]).toBe(255);
  });
});

