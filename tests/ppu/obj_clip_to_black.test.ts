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

describe('OBJ clip-to-black window mode (CGWSEL bit3) works', () => {
  it('applyInside=0 + clip: inside window is black for OBJ main; outside blends', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Brightness
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);

    // Enable OBJ on main, BG2 on subscreen
    w8(bus, mmio(0x2c), 0x10);
    w8(bus, mmio(0x2d), 0x02);

    // OBJ char base 0x1000; one sprite at (0,0) tile1
    w8(bus, mmio(0x01), 0x02);
    writeSolid(bus);
    w8(bus, mmio(0x02), 0x00);
    w8(bus, mmio(0x04), 0x00);
    w8(bus, mmio(0x04), 0x00);
    w8(bus, mmio(0x04), 0x01);
    w8(bus, mmio(0x04), 0x00);

    // BG2: char base 0x1000, map base 0, tile 1 pal group 1
    w8(bus, mmio(0x0b), 0x22);
    w8(bus, mmio(0x08), 0x00);
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);

    // Palettes: OBJ red (index1), BG2 green (index17)
    w8(bus, mmio(0x21), 2);  w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);

    // Color math add-half, mask selects OBJ
    w8(bus, mmio(0x31), 0x60 | 0x10);

    // Window A [0..3] enabled for OBJ, CGWSEL: applyInside=0, sub gate on, clip bit on
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x03);
    w8(bus, mmio(0x25), 0x01); // WOBJSEL: A enable
    w8(bus, mmio(0x30), 0x00 | 0x02 | 0x08 | (0 << 6));

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1], rgba[x*4+2]];
    // Inside A (x=1) -> clipped to black
    expect(px(1)[0]).toBeLessThan(10); expect(px(1)[1]).toBeLessThan(10); expect(px(1)[2]).toBeLessThan(10);
    // Outside A (x=5) -> blend red+green
    expect(px(5)[0]).toBeGreaterThan(100); expect(px(5)[1]).toBeGreaterThan(100);
  });
});

