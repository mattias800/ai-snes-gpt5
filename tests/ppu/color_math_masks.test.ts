import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
import { renderMainScreenRGBA } from '../../src/ppu/bg';

const mmio = (reg: number) => (0x00 << 16) | (0x2100 + (reg & 0xff));
const w8 = (bus: SNESBus, addr: number, v: number) => bus.write8(addr, v);

function mkBus() {
  const rom = new Uint8Array(0x20000);
  const cart = new Cartridge({ rom, mapping: 'lorom' });
  return new SNESBus(cart);
}

describe('Color math masks (per-layer selection)', () => {
  function writeSolidTile1(bus: SNESBus) {
    // Write 4bpp tile index 1 at char base 0x1000: plane0=0xFF for 8 rows, other planes 0
    for (let y = 0; y < 8; y++) {
      // plane0 row
      w8(bus, mmio(0x16), (0x1000 + 16 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff);
      w8(bus, mmio(0x19), 0x00);
      // plane1 row
      w8(bus, mmio(0x16), (0x1000 + 16 + 8 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + 8 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }
  }

  function setupCommon(bus: SNESBus) {
    // Full brightness
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    // BG1 map base 0x0000, BG2 map base 0x0400 bytes (word 0x0200)
    w8(bus, mmio(0x07), 0x00);
    w8(bus, mmio(0x08), 0x04);
    // BG1/BG2 char bases = 0x1000 words
    w8(bus, mmio(0x0b), 0x22);
    // Tile data
    writeSolidTile1(bus);
    // BG1 tilemap entry 0 -> tile 1, palette group 0
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x00);
    w8(bus, mmio(0x18), 0x01);
    w8(bus, mmio(0x19), 0x00);
    // BG2 tilemap entry at word 0x0200 -> tile 1, palette group 1
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x02);
    w8(bus, mmio(0x18), 0x01);
    w8(bus, mmio(0x19), 0x04);
    // Palette: index 1 = red (0x7C00), index 17 = green (0x03E0)
    // Red at index 1
    w8(bus, mmio(0x21), 2);
    w8(bus, mmio(0x22), 0x00);
    w8(bus, mmio(0x22), 0x7c);
    // Green at index 17
    w8(bus, mmio(0x21), 34);
    w8(bus, mmio(0x22), 0xe0);
    w8(bus, mmio(0x22), 0x03);
  }

  it('does NOT apply color math when mask selects BG2 but main is BG1', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    setupCommon(bus);

    // Main: BG1 only; Sub: BG2 only
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x2d), 0x02);

    // CGADSUB: enable + half + mask=BG2 only (bit1)
    w8(bus, mmio(0x31), 0x60 | 0x02);

    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    // Expect pure red from BG1 (no math applied)
    expect(rgba[0]).toBeGreaterThan(200); // R high
    expect(rgba[1]).toBeLessThan(10);     // G near 0
    expect(rgba[2]).toBeLessThan(10);     // B near 0
  });

  it('applies color math when mask selects BG2 and BG2 is main (sub is BG1)', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    setupCommon(bus);

    // Main: BG2 only; Sub: BG1 only
    w8(bus, mmio(0x2c), 0x02);
    w8(bus, mmio(0x2d), 0x01);

    // CGADSUB: enable + half + mask=BG2 only (bit1)
    w8(bus, mmio(0x31), 0x60 | 0x02);

    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    // Expect roughly (green + red) / 2 => both R and G > 0
    expect(rgba[0]).toBeGreaterThan(100); // R
    expect(rgba[1]).toBeGreaterThan(100); // G
    expect(rgba[2]).toBeLessThan(20);     // B remains low
  });
});

