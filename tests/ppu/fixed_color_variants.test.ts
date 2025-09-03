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

describe('Fixed color variants (multi-channel, full/half)', () => {
  function writeSolid(bus: SNESBus) {
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x1000 + 16 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff);
      w8(bus, mmio(0x19), 0x00);
      w8(bus, mmio(0x16), (0x1000 + 16 + 8 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + 8 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }
  }

  function setupNoSub(bus: SNESBus) {
    const ppu = bus.getPPU();
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    w8(bus, mmio(0x2c), 0x01); // BG1 main
    w8(bus, mmio(0x2d), 0x00); // no subscreen
    w8(bus, mmio(0x0b), 0x22);
    writeSolid(bus);
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);
    w8(bus, mmio(0x21), 2);  w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c); // red main
    return ppu;
  }

  it('add-full with fixed RG (both increase) using CGWSEL fixed mode', () => {
    const bus = mkBus();
    const ppu = setupNoSub(bus);
    // Enable fixed mode and set R=15, G=31
    w8(bus, mmio(0x30), 0x04);
    w8(bus, mmio(0x32), 0x20 | 15); // R=15
    w8(bus, mmio(0x32), 0x40 | 31); // G=31
    // CGADSUB: enable (bit5) full add, mask BG1
    w8(bus, mmio(0x31), 0x20 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    // Expect R still high (capped), G high due to fixed contribution
    expect(rgba[0]).toBeGreaterThan(200);
    expect(rgba[1]).toBeGreaterThan(150);
  });

  it('subtract-half with fixed RB (reduce R by some, B increases from fixed? actually subtract -> B near 0)', () => {
    const bus = mkBus();
    const ppu = setupNoSub(bus);
    // Use fixed with R=8, B=31
    w8(bus, mmio(0x30), 0x04);
    w8(bus, mmio(0x32), 0x20 | 8);
    w8(bus, mmio(0x32), 0x80 | 31);
    // CGADSUB: subtract + half + enable, mask=BG1
    w8(bus, mmio(0x31), 0x80 | 0x40 | 0x20 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    // R should still be reasonably high after half subtract (threshold ~80), B should be low (subtract)
    expect(rgba[0]).toBeGreaterThan(80);
    expect(rgba[2]).toBeLessThan(30);
  });
});

