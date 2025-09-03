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

function writeBG4SolidTile0(bus: SNESBus, charBaseWords: number) {
  // Write 2bpp tile data for BG4 (mode 0 uses 2bpp for all BGs)
  for (let y = 0; y < 8; y++) {
    // Plane 0: all bits set (0xff)
    w8(bus, mmio(0x16), ((charBaseWords + y*2) & 0xff));
    w8(bus, mmio(0x17), (((charBaseWords + y*2) >>> 8) & 0xff));
    w8(bus, mmio(0x18), 0xff);
    w8(bus, mmio(0x19), 0x00);
    // Plane 1: all bits clear (0x00)
    w8(bus, mmio(0x16), ((charBaseWords + y*2 + 1) & 0xff));
    w8(bus, mmio(0x17), (((charBaseWords + y*2 + 1) >>> 8) & 0xff));
    w8(bus, mmio(0x18), 0x00);
    w8(bus, mmio(0x19), 0x00);
  }
}

describe('BG4 2bpp basic render', () => {
  it('BG4 contributes when enabled and tilemap points to tile 0 at char base', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Full brightness
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 0 (all BGs are 2bpp, supports BG1-4)
    w8(bus, mmio(0x05), 0x00);
    // Enable BG4 only
    w8(bus, mmio(0x2c), 0x08);

    // BG4 map base 0, BG4 char base nibble=1 -> 0x1000 words (BG4=HIGH nibble)
    w8(bus, mmio(0x0a), 0x00);
    w8(bus, mmio(0x0c), 0x10);

    // Create 2bpp solid tile index 0 at 0x1000 words
    writeBG4SolidTile0(bus, 0x1000);

    // Tilemap entry 0 -> tile 0, palette group 0
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x00); w8(bus, mmio(0x19), 0x00);

    // CGRAM index 1 = red so pix=1 shows up
    w8(bus, mmio(0x21), 2);
    w8(bus, mmio(0x22), 0x00);
    w8(bus, mmio(0x22), 0x7c);

    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    // Expect red channel high
    expect(rgba[0]).toBeGreaterThan(200);
    expect(rgba[1]).toBeLessThan(10);
    expect(rgba[2]).toBeLessThan(10);
  });
});

