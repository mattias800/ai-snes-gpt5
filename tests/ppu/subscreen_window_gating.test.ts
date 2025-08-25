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

describe('Subscreen window gating (CGWSEL bit1)', () => {
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

  it('masks out subscreen outside the window, preventing blend there', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    w8(bus, mmio(0x00), 0x0f);
    // BG1 main, BG2 subscreen
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x2d), 0x02);
    w8(bus, mmio(0x0b), 0x22);
    // BG2 map base separate
    w8(bus, mmio(0x08), 0x04);

    writeSolidTile(bus);
    // BG1 tile pal0 at 0
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);
    // BG2 tile pal group1 at word 0x0200
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x02); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);

    // Palettes: BG1 index1 red, BG2 index17 green
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);

    // Window A: [0..3]. Enable window on BG1 and BG2 (sub), but only gate subscreen (CGWSEL bit1)
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x03);
    // Enable BG1 A and BG2 A
    w8(bus, mmio(0x23), 0x01); // BG1 A
    w8(bus, mmio(0x23), 0x01); // keep BG1 A
    // For BG2 A use W12SEL bit2
    // Note: we need to set both bits: BG1 A and BG2 A => 0x01 | 0x04 = 0x05
    w8(bus, mmio(0x23), 0x05);

    // CGWSEL: applyInside=1, subscreen gate on (bit1)
    w8(bus, mmio(0x30), 0x03);
    // CGADSUB: enable+half, mask=BG1 (main)
    w8(bus, mmio(0x31), 0x60 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // Inside window (x<=3) subscreen present => blend
    expect(px(1)[0]).toBeGreaterThan(100);
    expect(px(1)[1]).toBeGreaterThan(100);
    // Outside window (x>=4) subscreen masked => no blend (pure red)
    expect(px(5)[0]).toBeGreaterThan(200);
    expect(px(5)[1]).toBeLessThan(10);
  });

  it('with applyInside=0, masks subscreen inside the window (blend only outside)', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    w8(bus, mmio(0x00), 0x0f);
    // BG1 main, BG2 subscreen
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x2d), 0x02);
    w8(bus, mmio(0x0b), 0x22);
    w8(bus, mmio(0x08), 0x04);

    // Tiles
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

    // Palettes
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);

    // Window A: [0..3], enable subscreen gate
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x03);
    // Enable BG2 A for subscreen gating and also BG1 A for completeness (not required)
    w8(bus, mmio(0x23), 0x05);

    // CGWSEL: applyInside=0 (invert), subscreen gate on (bit1)
    w8(bus, mmio(0x30), 0x02);
    // CGADSUB: enable+half, mask=BG1
    w8(bus, mmio(0x31), 0x60 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // Inside window x<=3 -> sub masked -> no blend => red
    expect(px(1)[0]).toBeGreaterThan(200);
    expect(px(1)[1]).toBeLessThan(10);
    // Outside window x>=4 -> sub present -> blend
    expect(px(5)[0]).toBeGreaterThan(100);
    expect(px(5)[1]).toBeGreaterThan(100);
  });
});

