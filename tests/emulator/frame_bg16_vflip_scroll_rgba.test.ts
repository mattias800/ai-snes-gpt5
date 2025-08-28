import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
import { renderMainScreenRGBA } from '../../src/ppu/bg';

const mmio = (reg: number) => (0x00 << 16) | (0x2100 + (reg & 0xff));
const w8 = (bus: SNESBus, addr: number, v: number) => bus.write8(addr, v & 0xff);

function mkBus() {
  const rom = new Uint8Array(0x20000);
  const cart = new Cartridge({ rom, mapping: 'lorom' });
  return new SNESBus(cart);
}

function writeWord(bus: SNESBus, wordAddr: number, value: number) {
  w8(bus, mmio(0x16), wordAddr & 0xff);
  w8(bus, mmio(0x17), (wordAddr >>> 8) & 0xff);
  w8(bus, mmio(0x18), value & 0xff);
  w8(bus, mmio(0x19), (value >>> 8) & 0xff);
}

describe('Frame RGBA: BG1 16x16 V-flip and scroll offsets map subtiles correctly', () => {
  it('with V-flip and scroll (8,8), bottom-right quadrant becomes top-left', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Unblank, enable BG1
    w8(bus, mmio(0x00), 0x0f);
    w8(bus, mmio(0x2c), 0x01);

    // BGMODE: BG1 tile size 16
    w8(bus, mmio(0x05), 0x10);

    // BG1 bases and VMAIN
    w8(bus, mmio(0x07), 0x00);
    w8(bus, mmio(0x0b), 0x10);
    w8(bus, mmio(0x15), 0x00);

    // Compose a 16x16 tile made of 4 subtiles with distinct plane0 patterns:
    // tile 0: top-left -> left half (0xF0)
    // tile 1: top-right -> right half (0x0F)
    // tile 16: bottom-left -> solid (0xFF)
    // tile 17: bottom-right -> zeros (0x00)
    function writePattern(tileIndex: number, lowByte: number) {
      const base = 0x0800 + tileIndex * 16;
      for (let y = 0; y < 8; y++) writeWord(bus, base + y, lowByte & 0xff);
      for (let y = 0; y < 8; y++) writeWord(bus, base + 8 + y, 0x0000);
    }
    writePattern(0, 0xf0);
    writePattern(1, 0x0f);
    writePattern(16, 0xff);
    writePattern(17, 0x00);

    // Map entry (0,0) to tileIndex 0 (16x16 uses subtiles)
    writeWord(bus, 0x0000, 0x0000);

    // CGRAM palette index 1 = red
    w8(bus, mmio(0x21), 0x02);
    w8(bus, mmio(0x22), 0x00);
    w8(bus, mmio(0x22), 0x7c);

    // Apply V-flip (bit15) on tile entry
    writeWord(bus, 0x0000, 0x8000 | 0x0000);

    // Scroll (8,8) -> we sample the region such that the viewer's top-left aligns to the tile's bottom-right quadrant
    w8(bus, mmio(0x0d), 0x08); // BG1HOFS low
    w8(bus, mmio(0x0d), 0x00); // BG1HOFS high bits
    w8(bus, mmio(0x0e), 0x08); // BG1VOFS low
    w8(bus, mmio(0x0e), 0x00); // BG1VOFS high bits

    const W = 8, H = 8;
    const rgba = renderMainScreenRGBA(ppu, W, H);

    // Bottom-right quadrant (originally zeros) V-flipped and scrolled up/left should appear at viewer (0,0): expect black
    const tl = (0 * W + 0) * 4;
    expect(rgba[tl + 0]).toBeLessThan(20);
    expect(rgba[tl + 1]).toBeLessThan(20);
    expect(rgba[tl + 2]).toBeLessThan(20);
  });
});
