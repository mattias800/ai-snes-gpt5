import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
import { renderBG1RegionIndices } from '../../src/ppu/bg';

const mmio = (reg: number) => (0x00 << 16) | (0x2100 + (reg & 0xff));
const w8 = (bus: SNESBus, addr: number, v: number) => bus.write8(addr, v);

function mkBus() {
  const rom = new Uint8Array(0x20000);
  const cart = new Cartridge({ rom, mapping: 'lorom' });
  return new SNESBus(cart);
}

describe('BG1 register-driven render with scroll', () => {
  it('renders a scrolled 16x16 pixel region using BG1 registers', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Set BG1 map base to 0x0000 words, char base to 0x1000 words
    w8(bus, mmio(0x07), 0x00); // BG1SC
    w8(bus, mmio(0x0b), 0x20); // BG12NBA -> char base nibble 2 = 0x1000 words

    // Create a tile at 0x1000: set plane0 to 0xFF for all rows -> all pixels 1
    w8(bus, mmio(0x15), 0x00); // VMAIN: inc after high
    for (let y = 0; y < 8; y++) {
      // Low planes
      w8(bus, mmio(0x16), (0x1000 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff); // plane0
      w8(bus, mmio(0x19), 0x00); // plane1
      // High planes
      w8(bus, mmio(0x16), (0x1000 + 8 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 8 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }

    // Create a 32x32 tilemap at 0x0000 with all tiles = tile 0, palette 0
    for (let ty = 0; ty < 32; ty++) {
      for (let tx = 0; tx < 32; tx++) {
        const addr = ty * 32 + tx;
        w8(bus, mmio(0x16), addr & 0xff);
        w8(bus, mmio(0x17), (addr >>> 8) & 0xff);
        w8(bus, mmio(0x18), 0x00); // tile 0
        w8(bus, mmio(0x19), 0x00); // palette 0
      }
    }

    // Set scroll to (4, 4)
    w8(bus, mmio(0x0d), 0x04); // BG1HOFS low
    w8(bus, mmio(0x0d), 0x00); // BG1HOFS high
    w8(bus, mmio(0x0e), 0x04); // BG1VOFS low
    w8(bus, mmio(0x0e), 0x00); // BG1VOFS high

    // Render a 16x16 region
    const indices = renderBG1RegionIndices(ppu, 16, 16);

    // With scroll (4,4), tile 0 pixels are all 1. Check a known pixel.
    // At screen (0,0), world = (4,4), tile (0,0) pixel (4,4) = 1
    expect(indices[0]).toBe(1);
    // At screen (4,4), world = (8,8), tile (1,1) pixel (0,0) = 1
    expect(indices[4 * 16 + 4]).toBe(1);
  });
});
