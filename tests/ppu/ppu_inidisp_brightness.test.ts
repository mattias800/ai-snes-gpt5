import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
import { renderBG1RegionRGBA } from '../../src/ppu/bg';

const mmio = (reg: number) => (0x00 << 16) | (0x2100 + (reg & 0xff));
const w8 = (bus: SNESBus, addr: number, v: number) => bus.write8(addr, v);

function mkBus() {
  const rom = new Uint8Array(0x20000);
  const cart = new Cartridge({ rom, mapping: 'lorom' });
  return new SNESBus(cart);
}

describe('PPU INIDISP brightness and forced blank', () => {
  it('scales RGBA output by brightness level and forces blank when bit7 set', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Setup BG1 map/char and a tile with all pixels index 1
    w8(bus, mmio(0x07), 0x00); // BG1SC map base 0
    w8(bus, mmio(0x0b), 0x02); // BG1 char base 0x1000 words (nibble 2)
    // Tile plane0 = 0xFF for all rows (pix=1), other planes 0 at char base 0x1000
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x1000 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff);
      w8(bus, mmio(0x19), 0x00);
      w8(bus, mmio(0x16), (0x1000 + 8 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 8 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }
    // Tilemap entry at 0 -> tile 0, palette group 0 (map base at 0)
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x00);
    w8(bus, mmio(0x18), 0x00);
    w8(bus, mmio(0x19), 0x00);
    // CGRAM color for index 1 = white-ish 0x7FFF
    w8(bus, mmio(0x21), 1 * 2);
    w8(bus, mmio(0x22), 0xff);
    w8(bus, mmio(0x22), 0x7f);

    // Full brightness (0x0F)
    w8(bus, mmio(0x00), 0x0f);
    let rgba = renderBG1RegionRGBA(ppu, 8, 8);
    let px = [rgba[0], rgba[1], rgba[2], rgba[3]];
    expect(px[0]).toBe(255);
    expect(px[1]).toBe(255);
    expect(px[2]).toBe(255);

    // Brightness 0x08 -> scale = 8/15
    w8(bus, mmio(0x00), 0x08);
    rgba = renderBG1RegionRGBA(ppu, 8, 8);
    px = [rgba[0], rgba[1], rgba[2], rgba[3]];
    const expected = Math.round(255 * (8 / 15));
    expect(px[0]).toBe(expected);
    expect(px[1]).toBe(expected);
    expect(px[2]).toBe(expected);

    // Force blank
    w8(bus, mmio(0x00), 0x80 | 0x0f);
    rgba = renderBG1RegionRGBA(ppu, 8, 8);
    px = [rgba[0], rgba[1], rgba[2], rgba[3]];
    expect(px[0]).toBe(0);
    expect(px[1]).toBe(0);
    expect(px[2]).toBe(0);
    expect(px[3]).toBe(255);
  });
});

