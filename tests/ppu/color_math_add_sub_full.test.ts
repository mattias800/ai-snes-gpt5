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

describe('Color math without half (full add/sub)', () => {
  function writeSolid4bppTile(bus: SNESBus) {
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x1000 + 16 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff); // plane0
      w8(bus, mmio(0x19), 0x00);
      w8(bus, mmio(0x16), (0x1000 + 16 + 8 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + 8 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00); // plane1
      w8(bus, mmio(0x19), 0x00);
    }
  }

  function setupBG1Main_BG2Sub(bus: SNESBus) {
    w8(bus, mmio(0x00), 0x0f); // brightness
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    w8(bus, mmio(0x07), 0x00); // BG1 map base
    w8(bus, mmio(0x08), 0x04); // BG2 map base offset
    w8(bus, mmio(0x0b), 0x11); // char bases 0x1000
    writeSolid4bppTile(bus);
    // BG1 tile at 0 (pal0)
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);
    // BG2 tile at word 0x0200 (pal group1)
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x02); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);
    // Enable BG1 main, BG2 subscreen
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x2d), 0x02);
  }

  it('add-full saturates channels (BG1 red + BG2 green)', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    setupBG1Main_BG2Sub(bus);
    // Palettes: BG1 index1 red, BG2 index17 green
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);
    // CGADSUB: enable (bit5) + mask=BG1; add mode (bit7=0), full (bit6=0)
    w8(bus, mmio(0x31), 0x20 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    // Expect strong red and green (saturated), blue low
    expect(rgba[0]).toBeGreaterThan(200);
    expect(rgba[1]).toBeGreaterThan(200);
    expect(rgba[2]).toBeLessThan(20);
  });

  it('subtract-full clamps to 0 (white - blue)', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    setupBG1Main_BG2Sub(bus);
    // Palettes: BG1 index1 = white (0x7FFF), BG2 index17 = blue (0x001F)
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0xff); w8(bus, mmio(0x22), 0x7f);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0x1f); w8(bus, mmio(0x22), 0x00);
    // CGADSUB: subtract (bit7), enable (bit5), mask=BG1, full (bit6=0)
    w8(bus, mmio(0x31), 0x80 | 0x20 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    // Expect red and green high (white - blue leaves RG), blue ~0
    expect(rgba[0]).toBeGreaterThan(200);
    expect(rgba[1]).toBeGreaterThan(200);
    expect(rgba[2]).toBeLessThan(20);
  });
});

