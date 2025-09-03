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

describe('BG3 window B and invert B (simplified)', () => {
  function writeBG3Solid(bus: SNESBus) {
    for (let y = 0; y < 8; y++) {
      // 2bpp: plane0 row 0xFF, plane1 row 0
      w8(bus, mmio(0x16), (0x1000 + y*2) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + y*2) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff);
      w8(bus, mmio(0x19), 0x00);
      w8(bus, mmio(0x16), (0x1000 + y*2 + 1) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + y*2 + 1) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }
  }

  it('gates color math using window B when applyInside=1', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);

    // Enable BG3 main, BG2 subscreen
    w8(bus, mmio(0x2c), 0x04);
    w8(bus, mmio(0x2d), 0x02);

    // BG3 char base 0x1000, BG3 map base 0
    // BG34NBA: low nibble = BG3, high nibble = BG4
    // To set BG3 char base to 0x1000 words, we need low nibble = 1
    w8(bus, mmio(0x0c), 0x02);
    writeBG3Solid(bus);
    w8(bus, mmio(0x09), 0x00);
    // Tile entry 0 -> tile1 pal0
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);

    // BG2 as subscreen green
    w8(bus, mmio(0x0b), 0x22);
    w8(bus, mmio(0x08), 0x04);
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
    // BG2 tile at word 0x0200, pal group 1
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x02); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);

    // Palettes: BG3 index1 red, BG2 index17 green
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);

    // Window B [4..7], enable BG3 B via W34SEL bit1
    w8(bus, mmio(0x28), 0x04); w8(bus, mmio(0x29), 0x07);
    w8(bus, mmio(0x24), 0x02);
    // CGWSEL: applyInside=1
    w8(bus, mmio(0x30), 0x01);
    // CGADSUB: enable+half, mask=BG3
    w8(bus, mmio(0x31), 0x60 | 0x04);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // Inside B: x>=4 -> blend
    expect(px(5)[0]).toBeGreaterThan(100); expect(px(5)[1]).toBeGreaterThan(100);
    // Outside B: x<4 -> pure red
    expect(px(1)[0]).toBeGreaterThan(200); expect(px(1)[1]).toBeLessThan(10);
  });

  it('invert B flips gating for BG3 when applyInside=1', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    w8(bus, mmio(0x2c), 0x04); // BG3 main
    w8(bus, mmio(0x2d), 0x02); // BG2 subscreen

    // Setup tiles and palettes as above
    // BG34NBA: low nibble = BG3, high nibble = BG4
    // To set BG3 char base to 0x1000 words, we need low nibble = 1
    w8(bus, mmio(0x0c), 0x02);
    // write BG3 solid
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x1000 + y*2) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + y*2) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff);
      w8(bus, mmio(0x19), 0x00);
      w8(bus, mmio(0x16), (0x1000 + y*2 + 1) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + y*2 + 1) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }
    w8(bus, mmio(0x09), 0x00);
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);

    // BG2 solid green for sub
    w8(bus, mmio(0x0b), 0x22);
    w8(bus, mmio(0x08), 0x04);
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
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x02); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);

    // Palettes
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);

    // Window B [4..7], enable BG3 B and invert B (bit1 | bit5)
    w8(bus, mmio(0x28), 0x04); w8(bus, mmio(0x29), 0x07);
    w8(bus, mmio(0x24), 0x02 | 0x20);
    // applyInside=1
    w8(bus, mmio(0x30), 0x01);
    w8(bus, mmio(0x31), 0x60 | 0x04);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // With invert B, blend outside [4..7] and not inside
    expect(px(1)[0]).toBeGreaterThan(100); expect(px(1)[1]).toBeGreaterThan(100);
    expect(px(5)[0]).toBeGreaterThan(200); expect(px(5)[1]).toBeLessThan(10);
  });
});

