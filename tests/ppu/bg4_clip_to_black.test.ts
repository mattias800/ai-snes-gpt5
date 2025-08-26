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

function writeBG4SolidTile0(bus: SNESBus, charBaseWords: number) {
  for (let y = 0; y < 8; y++) {
    w8(bus, mmio(0x16), ((charBaseWords + y) & 0xff));
    w8(bus, mmio(0x17), (((charBaseWords + y) >>> 8) & 0xff));
    w8(bus, mmio(0x18), 0xff);
    w8(bus, mmio(0x19), 0x00);
  }
}

describe('BG4 clip-to-black vs prevent-math', () => {
  it('clip-to-black outside window when applyInside=1', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    // Brightness
    w8(bus, mmio(0x00), 0x0f);
    // BG4 main only
    w8(bus, mmio(0x2c), 0x08);
    w8(bus, mmio(0x2d), 0x00);
    // BG4 map base 0, char base 0x0800
    w8(bus, mmio(0x0a), 0x00); w8(bus, mmio(0x0c), 0x01);
    writeBG4SolidTile0(bus, 0x0800);
    // BG4 tilemap
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x00); w8(bus, mmio(0x19), 0x00);
    // Palette index1 red
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    // Use fixed subscreen green; enable clip-to-black (bit3), applyInside=1
    w8(bus, mmio(0x30), 0x01 | 0x04 | 0x08);
    w8(bus, mmio(0x32), 0x40 | 31);
    // Color math add-half globally (mask=0)
    w8(bus, mmio(0x31), 0x60);
    // Window A [0..3] enabled for BG4
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x03);
    w8(bus, mmio(0x24), 0x04);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1], rgba[x*4+2]];
    // Inside A -> blend red+green => both > 80
    expect(px(1)[0]).toBeGreaterThan(80); expect(px(1)[1]).toBeGreaterThan(80);
    // Outside A -> clipped to black
    expect(px(5)[0]).toBeLessThan(10); expect(px(5)[1]).toBeLessThan(10); expect(px(5)[2]).toBeLessThan(10);
  });

  it('prevent-math outside window when clip bit off', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    // BG4 main only
    w8(bus, mmio(0x2c), 0x08); w8(bus, mmio(0x2d), 0x00);
    w8(bus, mmio(0x0a), 0x00); w8(bus, mmio(0x0c), 0x01);
    writeBG4SolidTile0(bus, 0x0800);
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x00); w8(bus, mmio(0x19), 0x00);
    // Palette index1 red
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    // Fixed green subscreen; clip OFF; applyInside=1
    w8(bus, mmio(0x30), 0x01 | 0x04);
    w8(bus, mmio(0x32), 0x40 | 31);
    // Color math add-half globally
    w8(bus, mmio(0x31), 0x60);
    // Window A [0..3]
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x03); w8(bus, mmio(0x24), 0x04);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // Inside A -> blend
    expect(px(1)[0]).toBeGreaterThan(80); expect(px(1)[1]).toBeGreaterThan(80);
    // Outside A -> pure red
    expect(px(5)[0]).toBeGreaterThan(200); expect(px(5)[1]).toBeLessThan(20);
  });
});

