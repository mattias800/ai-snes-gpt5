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

describe('Frame RGBA: window + fixed-color add-half over BG1 (inside vs outside)', () => {
  it('inside window blends red with blue fixed color (purple), outside stays red', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Unblank, enable BG1
    w8(bus, mmio(0x00), 0x0f);
    w8(bus, mmio(0x2c), 0x01);

    // BG1 bases and VMAIN
    w8(bus, mmio(0x07), 0x00); // map base 0x0000
    w8(bus, mmio(0x0b), 0x01); // char base 0x0800 words
    w8(bus, mmio(0x15), 0x00);

    // Write red 4bpp tile 0 at 0x0800 (palette index 1 solid)
    const tileBaseWord = 0x0800;
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

    // Fixed color mode: blue intensity 31; enable fixed as subscreen when none
    // COLDATA simplified: set blue using 0x80 | 31
    w8(bus, mmio(0x32), 0x80 | 31);

    // CGADSUB: half add (bit6=1), subtract=0, mask=0 -> apply to all main layers
    w8(bus, mmio(0x31), 0x40);

    // CGWSEL: bit2 fixed-color-as-sub, bit0 applyInside, combine OR (bits6-7=00)
    // Also set window A for BG1 (W12SEL bit0) and range [0..7]
    w8(bus, mmio(0x23), 0x01); // W12SEL enable A for BG1
    w8(bus, mmio(0x26), 0x00); // WH0 left
    w8(bus, mmio(0x27), 0x07); // WH1 right
    w8(bus, mmio(0x30), 0x04 | 0x01);

    const W = 16, H = 8;
    const rgba = renderMainScreenRGBA(ppu, W, H);

    // (0,0) is inside window: expect purple-ish (add-half red+blue -> both ~>100)
    expect(rgba[0]).toBeGreaterThan(100);
    expect(rgba[1]).toBeLessThan(40);
    expect(rgba[2]).toBeGreaterThan(100);

    // (8,0) is outside window: expect pure red
    const o = (0 * W + 8) * 4;
    expect(rgba[o + 0]).toBeGreaterThan(200);
    expect(rgba[o + 1]).toBeLessThan(40);
    expect(rgba[o + 2]).toBeLessThan(40);
  });
});
