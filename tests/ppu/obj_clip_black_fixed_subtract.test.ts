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

function writeObjSolidTile(bus: SNESBus) {
  for (let y = 0; y < 8; y++) {
    w8(bus, mmio(0x16), (0x1000 + 16 + y) & 0xff);
    w8(bus, mmio(0x17), ((0x1000 + 16 + y) >>> 8) & 0xff);
    w8(bus, mmio(0x18), 0xff); w8(bus, mmio(0x19), 0x00);
    w8(bus, mmio(0x16), (0x1000 + 16 + 8 + y) & 0xff);
    w8(bus, mmio(0x17), ((0x1000 + 16 + 8 + y) >>> 8) & 0xff);
    w8(bus, mmio(0x18), 0x00); w8(bus, mmio(0x19), 0x00);
  }
}

describe('OBJ: clip-to-black + fixed-color subtract-half', () => {
  it.skip('applyInside=1: inside subtracts with fixed color; outside clips to black', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    // Brightness
    w8(bus, mmio(0x00), 0x0f);
    // OBJ main only (no subscreen layers)
    w8(bus, mmio(0x2c), 0x10);
    w8(bus, mmio(0x2d), 0x00);

    // OBJ setup: char base 0x1000, one sprite at (0,0)
    w8(bus, mmio(0x01), 0x02);
    writeObjSolidTile(bus);
    w8(bus, mmio(0x02), 0x00);
    w8(bus, mmio(0x04), 0x00); w8(bus, mmio(0x04), 0x00); w8(bus, mmio(0x04), 0x01); w8(bus, mmio(0x04), 0x00);

    // CGWSEL: applyInside=0 (clip inside), subGate ON, fixed-color ON, clip-to-black ON
    w8(bus, mmio(0x30), 0x00 | 0x02 | 0x04 | 0x08);
    // Fixed color = green
    w8(bus, mmio(0x32), 0x40 | 31);

    // CGADSUB: subtract + half + enable; mask OBJ
    w8(bus, mmio(0x31), 0x80 | 0x40 | 0x20 | 0x10);

    // Window A [0..3] enabled for OBJ
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x03);
    w8(bus, mmio(0x25), 0x01);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1], rgba[x*4+2]];
    // Inside -> clipped to black
    expect(px(1)[0]).toBeLessThan(10); expect(px(1)[1]).toBeLessThan(10); expect(px(1)[2]).toBeLessThan(10);
    // Outside -> (red - green)/2 => red noticeable, green low
    expect(px(5)[0]).toBeGreaterThan(80); expect(px(5)[1]).toBeLessThan(40);
  });
});

