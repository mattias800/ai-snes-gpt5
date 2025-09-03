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

describe('Color math: add/sub half with backdrop (simplified)', () => {
  it('adds half backdrop when CGADSUB enable, half, add', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Full brightness, enable BG1
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    w8(bus, mmio(0x2c), 0x01);

    // BG1 setup: tile1 solid at map (0,0), char base 0x1000
    w8(bus, mmio(0x07), 0x00);
    w8(bus, mmio(0x0b), 0x02);
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x1000 + 16 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00); // red=0 for source color, to test backdrop influence
      w8(bus, mmio(0x19), 0x00);
      w8(bus, mmio(0x16), (0x1000 + 16 + 8 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + 8 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }
    // Map tile1
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x00);
    w8(bus, mmio(0x18), 0x01);
    w8(bus, mmio(0x19), 0x00);

    // Palette: index 1 = black (so main is black), backdrop = blue max (0x001F)
    w8(bus, mmio(0x21), 2); // index 1
    w8(bus, mmio(0x22), 0x00);
    w8(bus, mmio(0x22), 0x00);
    w8(bus, mmio(0x21), 0x00); // index 0 backdrop
    w8(bus, mmio(0x22), 0x1f);
    w8(bus, mmio(0x22), 0x00);

    // Enable color math: add (bit7=0), half (bit6=1), enable (bit5=1)
    w8(bus, mmio(0x31), 0x60);

    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    // Expect roughly half-blue (~127 on blue channel)
    expect(rgba[2]).toBeGreaterThan(120);
  });

  it('subtract half backdrop when CGADSUB subtract', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Full brightness, enable BG1
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    w8(bus, mmio(0x2c), 0x01);

    // BG1: tile1 solid with red max so subtraction from blue backdrop does nothing to red
    w8(bus, mmio(0x07), 0x00);
    w8(bus, mmio(0x0b), 0x02);
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x1000 + 16 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff); // plane0 -> pix=1 solid
      w8(bus, mmio(0x19), 0x00);
      w8(bus, mmio(0x16), (0x1000 + 16 + 8 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + 8 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x00);
    w8(bus, mmio(0x18), 0x01);
    w8(bus, mmio(0x19), 0x00);

    // Palette: index 1 = white (0x7FFF), backdrop blue max
    w8(bus, mmio(0x21), 2);
    w8(bus, mmio(0x22), 0xff);
    w8(bus, mmio(0x22), 0x7f);
    w8(bus, mmio(0x21), 0x00);
    w8(bus, mmio(0x22), 0x1f);
    w8(bus, mmio(0x22), 0x00);

    // CGADSUB subtract half (bit7=1, bit6=1, bit5=1) => 0xE0
    w8(bus, mmio(0x31), 0xe0);

    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    // With subtract-half, blue becomes (31-31)/2=0 -> near zero in RGBA
    expect(rgba[2]).toBeLessThan(10);
  });
});

