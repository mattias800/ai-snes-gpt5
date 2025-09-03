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

describe('Frame RGBA: window + fixed-color subtract-half over BG1 (inside vs outside)', () => {
  it('inside window halves red due to half-subtract; outside remains full red', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Unblank, enable BG1
    w8(bus, mmio(0x00), 0x0f);
    w8(bus, mmio(0x2c), 0x01);

    // BG1 bases and VMAIN
    w8(bus, mmio(0x07), 0x00); // map base 0x0000
    w8(bus, mmio(0x0b), 0x01); // BG1 char base nibble=1 -> 0x1000 words
    w8(bus, mmio(0x15), 0x80);

    // Write red 4bpp tile 0 at 0x0800 (palette index 1 solid)
    const tileBaseWord = 0x1000;
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (tileBaseWord + y) & 0xff);
      w8(bus, mmio(0x17), ((tileBaseWord + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff);
      w8(bus, mmio(0x19), 0x00);
    }
    for (let y = 0; y < 8; y++) {
      const addr = tileBaseWord + 8 + y;
      w8(bus, mmio(0x16), addr & 0xff);
      w8(bus, mmio(0x17), (addr >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }
    // Tilemap (0,0) -> tile 0
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x00);
    w8(bus, mmio(0x18), 0x00);
    w8(bus, mmio(0x19), 0x00);

    // CGRAM palette index 1 = red max
    w8(bus, mmio(0x21), 0x02);
    w8(bus, mmio(0x22), 0x00);
    w8(bus, mmio(0x22), 0x7c);

    // Fixed color mode: blue intensity 31; we will use fixed color as subscreen where absent
    w8(bus, mmio(0x32), 0x80 | 31);

    // CGADSUB: subtract + half (bit7=1, bit6=1); mask=0 -> apply to all layers
    w8(bus, mmio(0x31), 0xC0);

    // Window: applyInside (bit0=1), enable window A for BG1, range [0..7]
    w8(bus, mmio(0x23), 0x01);
    w8(bus, mmio(0x26), 0x00);
    w8(bus, mmio(0x27), 0x07);
    // CGWSEL: bit2 fixed-as-sub, bit0 applyInside
    w8(bus, mmio(0x30), 0x04 | 0x01);

    const W = 16, H = 8;
    const rgba = renderMainScreenRGBA(ppu, W, H);

    // Inside window at x=0: red halved (roughly >100), blue stays low; outside at x=8: full red (>200)
    const inside = (0 * W + 0) * 4;
    expect(rgba[inside + 0]).toBeGreaterThan(100);
    expect(rgba[inside + 1]).toBeLessThan(50);
    expect(rgba[inside + 2]).toBeLessThan(50);

    const outside = (0 * W + 8) * 4;
    expect(rgba[outside + 0]).toBeGreaterThan(200);
    expect(rgba[outside + 1]).toBeLessThan(50);
    expect(rgba[outside + 2]).toBeLessThan(50);
  });
});
