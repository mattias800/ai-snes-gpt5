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

describe('Per-layer window invert flags (simplified mapping)', () => {
  function setupTiles(bus: SNESBus) {
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
    // BG1 tile pal0 at 0
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);
    // BG2 tile pal group1 at word 0x0200
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x02); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);
  }

  it('BG1 invert A (bit4) flips gating for BG1 only, with applyInside=1', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    w8(bus, mmio(0x00), 0x0f);
    // Main BG1, Sub BG2
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x2d), 0x02);
    // Bases
    w8(bus, mmio(0x0b), 0x22);
    w8(bus, mmio(0x08), 0x04);
    setupTiles(bus);
    // Palettes: BG1 red, BG2 green
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);

    // Window A [0..3]
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x03);

    // Enable BG1 A and invert A for BG1 -> w12sel bits: A=0x01, invA=0x10 => 0x11
    w8(bus, mmio(0x23), 0x11);
    // applyInside=1, combine OR
    w8(bus, mmio(0x30), 0x01);
    // Color math enable+half, mask=BG1
    w8(bus, mmio(0x31), 0x60 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // With invert, BG1 blends outside A (x>=4), not inside
    expect(px(1)[0]).toBeGreaterThan(200); expect(px(1)[1]).toBeLessThan(10);
    expect(px(5)[0]).toBeGreaterThan(100); expect(px(5)[1]).toBeGreaterThan(100);
  });

  it('BG1 invert A with applyInside=0 nets effect of blending inside original A', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    w8(bus, mmio(0x00), 0x0f);
    w8(bus, mmio(0x2c), 0x01); // BG1 main
    w8(bus, mmio(0x2d), 0x02); // BG2 sub
    w8(bus, mmio(0x0b), 0x22);
    w8(bus, mmio(0x08), 0x04);
    setupTiles(bus);
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);

    // A [0..3]
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x03);
    // BG1 A enabled + invert A
    w8(bus, mmio(0x23), 0x11);
    // applyInside=0 (outside combined) -> since combined is outside A due to invert, outside-of-combined = inside original A
    w8(bus, mmio(0x30), 0x00);
    w8(bus, mmio(0x31), 0x60 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // Expect blend inside original A (x<=3), not outside
    expect(px(1)[0]).toBeGreaterThan(100); expect(px(1)[1]).toBeGreaterThan(100);
    expect(px(5)[0]).toBeGreaterThan(200); expect(px(5)[1]).toBeLessThan(10);
  });
});

