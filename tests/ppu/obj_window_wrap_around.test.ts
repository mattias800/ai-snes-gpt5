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

describe('OBJ window wrap-around and invert edge cases', () => {
  function setupOBJMain_BG2Sub(bus: SNESBus) {
    const ppu = bus.getPPU();
    w8(bus, mmio(0x00), 0x0f);
    // OBJ main, BG2 subscreen
    w8(bus, mmio(0x2c), 0x10);
    w8(bus, mmio(0x2d), 0x02);
    // OBJ char base 0x1000, one sprite at (0,0) tile1
    w8(bus, mmio(0x01), 0x02);
    writeSolid(bus);
    w8(bus, mmio(0x02), 0x00);
    w8(bus, mmio(0x04), 0x00);
    w8(bus, mmio(0x04), 0x00);
    w8(bus, mmio(0x04), 0x01);
    w8(bus, mmio(0x04), 0x00);
    // BG2 green background
    w8(bus, mmio(0x0b), 0x22);
    w8(bus, mmio(0x08), 0x00);
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);
    // Palettes: OBJ red, BG2 green
    w8(bus, mmio(0x21), 2);  w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);
    // Color math add-half, mask selects OBJ; enable subscreen window gating
    w8(bus, mmio(0x31), 0x60 | 0x10);
    return ppu;
  }

  it('OR combine with wrap-around A: A[6..1] wraps and blends for x=0,1 and 6,7', () => {
    const bus = mkBus();
    const ppu = setupOBJMain_BG2Sub(bus);
    // Window A wrap-around: [6..1]
    w8(bus, mmio(0x26), 0x06); w8(bus, mmio(0x27), 0x01);
    // Enable OBJ A only
    w8(bus, mmio(0x25), 0x01);
    // CGWSEL: applyInside=1, OR combine
    w8(bus, mmio(0x30), 0x01 | (0 << 6));
    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // x=0,1 and x=6,7 inside -> blend
    expect(px(0)[0]).toBeGreaterThan(100); expect(px(0)[1]).toBeGreaterThan(100);
    expect(px(7)[0]).toBeGreaterThan(100); expect(px(7)[1]).toBeGreaterThan(100);
    // x=3 outside -> pure red
    expect(px(3)[0]).toBeGreaterThan(200); expect(px(3)[1]).toBeLessThan(10);
  });

  it('XOR with wrap-around: A[6..7], B[0..1] -> XOR true at exactly one region', () => {
    const bus = mkBus();
    const ppu = setupOBJMain_BG2Sub(bus);
    // A [6..7], B [0..1]
    w8(bus, mmio(0x26), 0x06); w8(bus, mmio(0x27), 0x07);
    w8(bus, mmio(0x28), 0x00); w8(bus, mmio(0x29), 0x01);
    // Enable OBJ A|B
    w8(bus, mmio(0x25), 0x03);
    // XOR
    w8(bus, mmio(0x30), 0x01 | (2 << 6));
    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // x=6,7 in A-only -> blend; x=0,1 in B-only -> blend; x=7-> also in B? no; x=2 outside -> red
    expect(px(6)[0]).toBeGreaterThan(100); expect(px(6)[1]).toBeGreaterThan(100);
    expect(px(1)[0]).toBeGreaterThan(100); expect(px(1)[1]).toBeGreaterThan(100);
    expect(px(2)[0]).toBeGreaterThan(200); expect(px(2)[1]).toBeLessThan(10);
  });
});

