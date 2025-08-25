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

describe('Window wrap-around (left > right) behavior (simplified)', () => {
  function writeSolidTile(bus: SNESBus) {
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

  it('A window with left>right blends on both ends when applyInside=1', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Brightness, BG1 main, BG2 subscreen
    w8(bus, mmio(0x00), 0x0f);
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x2d), 0x02);

    // Char bases, BG2 map base
    w8(bus, mmio(0x0b), 0x22);
    w8(bus, mmio(0x08), 0x04);

    writeSolidTile(bus);
    // BG1 tile red at 0, BG2 tile green at word 0x0200
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x02); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);

    // Palettes
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);

    // Window A with left>right: [6..1] (wrap)
    w8(bus, mmio(0x26), 0x06);
    w8(bus, mmio(0x27), 0x01);
    // Enable BG1 A
    w8(bus, mmio(0x23), 0x01);
    // applyInside=1, OR
    w8(bus, mmio(0x30), 0x01);
    // Color math enable+half, mask=BG1
    w8(bus, mmio(0x31), 0x60 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];

    // Expect blend at x<=1 and x>=6; no blend around middle (x=3)
    expect(px(0)[0]).toBeGreaterThan(100); expect(px(0)[1]).toBeGreaterThan(100);
    expect(px(3)[0]).toBeGreaterThan(200); expect(px(3)[1]).toBeLessThan(10);
    expect(px(7)[0]).toBeGreaterThan(100); expect(px(7)[1]).toBeGreaterThan(100);
  });
});

