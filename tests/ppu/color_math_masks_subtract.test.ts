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

describe('Color math masks (subtract mode)', () => {
  function writeSolidTile1_4bpp(bus: SNESBus) {
    for (let y = 0; y < 8; y++) {
      // plane0 row -> 0xFF
      w8(bus, mmio(0x16), (0x1000 + 16 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff);
      w8(bus, mmio(0x19), 0x00);
      // plane1 row -> 0x00
      w8(bus, mmio(0x16), (0x1000 + 16 + 8 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + 8 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
      // planes2/3 are implicitly zero
    }
  }

  function setupCommon(bus: SNESBus) {
    // Full brightness
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    // Map bases: BG1=0x0000, BG2=0x0400 bytes (word 0x0200)
    w8(bus, mmio(0x07), 0x00);
    w8(bus, mmio(0x08), 0x04);
    // Char bases both = 0x1000 words
    w8(bus, mmio(0x0b), 0x11);
    // Tile data
    writeSolidTile1_4bpp(bus);
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
  }

  it('applies subtract-half when mask selects BG1 and BG1 is main (sub = BG2)', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    setupCommon(bus);

    // Main = BG1 only; Sub = BG2 only
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x2d), 0x02);

    // Palette: BG1 index 1 = white (0x7FFF), BG2 index 17 = blue (0x001F)
    w8(bus, mmio(0x21), 2); // index 1
    w8(bus, mmio(0x22), 0xff);
    w8(bus, mmio(0x22), 0x7f);
    w8(bus, mmio(0x21), 34); // index 17
    w8(bus, mmio(0x22), 0x1f);
    w8(bus, mmio(0x22), 0x00);

    // CGADSUB: subtract (bit7), half (bit6), enable (bit5), mask=BG1 (bit0)
    w8(bus, mmio(0x31), 0xe0 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    // (white - blue)/2 => blue becomes ~0, red and green remain high
    expect(rgba[2]).toBeLessThan(20); // blue low
    expect(rgba[0]).toBeGreaterThan(120); // red mid-high
    expect(rgba[1]).toBeGreaterThan(120); // green mid-high
  });

  it('does NOT apply subtract when mask selects BG2 but main is BG1', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    setupCommon(bus);

    // Main = BG1 only; Sub = BG2 only
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x2d), 0x02);

    // Palette: BG1 index 1 = red (0x7C00), BG2 index 17 = blue (0x001F)
    w8(bus, mmio(0x21), 2);
    w8(bus, mmio(0x22), 0x00);
    w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34);
    w8(bus, mmio(0x22), 0x1f);
    w8(bus, mmio(0x22), 0x00);

    // CGADSUB: subtract-half enable, mask=BG2 only (bit1)
    w8(bus, mmio(0x31), 0xe0 | 0x02);

    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    // Expect pure red from BG1 (no math)
    expect(rgba[0]).toBeGreaterThan(200); // R high
    expect(rgba[1]).toBeLessThan(10);     // G low
    expect(rgba[2]).toBeLessThan(10);     // B low
  });
});

