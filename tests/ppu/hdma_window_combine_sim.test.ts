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

describe('HDMA-like mid-scanline window combine changes (simulated)', () => {
  function writeSolid4bppTile(bus: SNESBus) {
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

  it('switches CGWSEL combine OR -> AND mid-line', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Brightness, enable BG1 main, BG2 subscreen
    w8(bus, mmio(0x00), 0x0f);
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x2d), 0x02);

    // Char bases and BG2 map base
    w8(bus, mmio(0x0b), 0x22);
    w8(bus, mmio(0x08), 0x04);

    // Tiles
    writeSolid4bppTile(bus);
    // BG1 tile at 0 pal0, BG2 tile at 0x0200 pal group1
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x02); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);

    // Palettes: BG1 index1 red, BG2 index17 green
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);

    // Windows: A [0..3], B [2..5]; enable BG1 A and B
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x03);
    w8(bus, mmio(0x28), 0x02); w8(bus, mmio(0x29), 0x05);
    w8(bus, mmio(0x23), 0x03);

    // Color math enable+half mask=BG1
    w8(bus, mmio(0x31), 0x60 | 0x01);

    // Left half: combine OR (00), applyInside=1
    w8(bus, mmio(0x30), 0x01 | (0 << 6));
    const left = renderMainScreenRGBA(ppu, 4, 1);

    // Right half: combine AND (01), applyInside=1
    w8(bus, mmio(0x30), 0x01 | (1 << 6));
    const right = renderMainScreenRGBA(ppu, 4, 1);

    const rgba = new Uint8ClampedArray(8 * 4);
    rgba.set(left, 0);
    rgba.set(right, 16);

    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // On left (OR): x=1 blended and x=3 blended
    expect(px(1)[0]).toBeGreaterThan(100);
    expect(px(1)[1]).toBeGreaterThan(100);
    expect(px(3)[0]).toBeGreaterThan(100);
    expect(px(3)[1]).toBeGreaterThan(100);
    // On right (AND): only overlap at x=2..3; global x=5 (right half x=1) is not blended
    expect(px(5)[0]).toBeGreaterThan(200);
    expect(px(5)[1]).toBeLessThan(10);
  });

  it('flips applyInside mid-line (inside vs outside)', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Brightness, enable BG1 main, BG2 subscreen
    w8(bus, mmio(0x00), 0x0f);
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x2d), 0x02);
    w8(bus, mmio(0x0b), 0x22);
    w8(bus, mmio(0x08), 0x04);

    writeSolid4bppTile(bus);
    // BG1 tile, BG2 tile
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x02); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);

    // Palettes
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);

    // Window A [0..3]; BG1 A enabled
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x03);
    w8(bus, mmio(0x23), 0x01);

    // Color math enable+half
    w8(bus, mmio(0x31), 0x60 | 0x01);

    // Left: applyInside=1 (blend inside)
    w8(bus, mmio(0x30), 0x01 | (0 << 6));
    const left = renderMainScreenRGBA(ppu, 4, 1);

    // Right: applyInside=0 (blend outside)
    w8(bus, mmio(0x30), 0x00 | (0 << 6));
    const right = renderMainScreenRGBA(ppu, 4, 1);

    const rgba = new Uint8ClampedArray(8 * 4);
    rgba.set(left, 0);
    rgba.set(right, 16);

    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // Left x=1 blended
    expect(px(1)[0]).toBeGreaterThan(100);
    expect(px(1)[1]).toBeGreaterThan(100);
    // Right x=5 (outside window) not blended (since behavior in simplified model applies only to main layer windows)
    expect(px(5)[0]).toBeGreaterThan(200);
    expect(px(5)[1]).toBeLessThan(10);
  });
});

