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

describe('Color window: prevent-math vs clip-to-black (simplified CGWSEL bit3)', () => {
  function setup(bus: SNESBus) {
    const ppu = bus.getPPU();
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    // BG1 main, BG2 sub
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x2d), 0x02);
    // Char bases and maps
    w8(bus, mmio(0x0b), 0x11);
    w8(bus, mmio(0x08), 0x04);
    writeSolid(bus);
    // BG1 red tile; BG2 green tile
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x02); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);
    // Palettes
    w8(bus, mmio(0x21), 2);  w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c); // red
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03); // green
    // Color math add-half, mask BG1
    w8(bus, mmio(0x31), 0x60 | 0x01);
    return ppu;
  }

  it('prevent-math (clip bit off): outside window shows pure main color', () => {
    const bus = mkBus();
    const ppu = setup(bus);
    // Window A [0..3], enable BG1 A
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x03);
    w8(bus, mmio(0x23), 0x01);
    // CGWSEL applyInside=1, combine OR, sub gate on, clip bit off
    w8(bus, mmio(0x30), 0x01 | 0x02 | (0 << 6));

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1], rgba[x*4+2]];
    // Inside A -> blend
    expect(px(1)[0]).toBeGreaterThan(100); expect(px(1)[1]).toBeGreaterThan(100);
    // Outside A -> no math, pure red
    expect(px(5)[0]).toBeGreaterThan(200); expect(px(5)[1]).toBeLessThan(10); expect(px(5)[2]).toBeLessThan(10);
  });

  it('clip-to-black (clip bit on): outside window is black (applyInside=1)', () => {
    const bus = mkBus();
    const ppu = setup(bus);
    // Window A [0..3], enable BG1 A
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x03);
    w8(bus, mmio(0x23), 0x01);
    // CGWSEL applyInside=1, OR, sub gate on, clip bit on (bit3)
    w8(bus, mmio(0x30), 0x01 | 0x02 | 0x08 | (0 << 6));

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1], rgba[x*4+2]];
    // Inside A -> blend
    expect(px(1)[0]).toBeGreaterThan(100); expect(px(1)[1]).toBeGreaterThan(100);
    // Outside A -> clipped to black
    expect(px(5)[0]).toBeLessThan(10); expect(px(5)[1]).toBeLessThan(10); expect(px(5)[2]).toBeLessThan(10);
  });

  it('clip-to-black with applyInside=0: inside window is black, outside blends', () => {
    const bus = mkBus();
    const ppu = setup(bus);
    // Window A [0..3], enable BG1 A
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x03);
    w8(bus, mmio(0x23), 0x01);
    // CGWSEL applyInside=0, OR, sub gate on, clip bit on
    w8(bus, mmio(0x30), 0x00 | 0x02 | 0x08 | (0 << 6));

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1], rgba[x*4+2]];
    // Inside A -> clipped to black
    expect(px(1)[0]).toBeLessThan(10); expect(px(1)[1]).toBeLessThan(10); expect(px(1)[2]).toBeLessThan(10);
    // Outside A -> blends
    expect(px(5)[0]).toBeGreaterThan(100); expect(px(5)[1]).toBeGreaterThan(100);
  });
});

