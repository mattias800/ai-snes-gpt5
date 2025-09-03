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

describe('BG2 window combine modes (A/B, applyInside=1)', () => {
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

  function setupBG2Main_BG1Sub(bus: SNESBus) {
    const ppu = bus.getPPU();
    // Brightness
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    // BG2 main, BG1 subscreen
    w8(bus, mmio(0x2c), 0x02);
    w8(bus, mmio(0x2d), 0x01);

    // Set BG1 map base to 0x0200 words to avoid overlap; BG2 map base 0
    w8(bus, mmio(0x07), 0x04);
    w8(bus, mmio(0x08), 0x00);
    // Char bases 0x1000 for both
    w8(bus, mmio(0x0b), 0x22);

    writeSolid4bppTile(bus);

    // BG2 tile at 0 -> tile1 pal0 (red)
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);
    // BG1 tile at word 0x0200 -> tile1 pal group1 (green)
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x02); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);

    // Palettes: index1 red, index17 green
    w8(bus, mmio(0x21), 2);  w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);

    // Color math enable+half, mask=BG2
    w8(bus, mmio(0x31), 0x60 | 0x02);
    return ppu;
  }

  it('OR combine (A or B) blends where A or B set', () => {
    const bus = mkBus();
    const ppu = setupBG2Main_BG1Sub(bus);
    // A [0..1], B [3..4]
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x01);
    w8(bus, mmio(0x28), 0x03); w8(bus, mmio(0x29), 0x04);
    // W12SEL: enable BG2 A and B bits (0x04 | 0x08)
    w8(bus, mmio(0x23), 0x0c);
    // CGWSEL: applyInside=1, OR
    w8(bus, mmio(0x30), 0x01 | (0 << 6));

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    expect(px(0)[0]).toBeGreaterThan(100); expect(px(0)[1]).toBeGreaterThan(100);
    expect(px(2)[0]).toBeGreaterThan(200); expect(px(2)[1]).toBeLessThan(10);
    expect(px(3)[0]).toBeGreaterThan(100); expect(px(3)[1]).toBeGreaterThan(100);
  });

  it('AND combine blends only in overlap', () => {
    const bus = mkBus();
    const ppu = setupBG2Main_BG1Sub(bus);
    // A [1..2], B [2..3] -> overlap at x=2
    w8(bus, mmio(0x26), 0x01); w8(bus, mmio(0x27), 0x02);
    w8(bus, mmio(0x28), 0x02); w8(bus, mmio(0x29), 0x03);
    w8(bus, mmio(0x23), 0x0c);
    w8(bus, mmio(0x30), 0x01 | (1 << 6));

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    expect(px(2)[0]).toBeGreaterThan(100); expect(px(2)[1]).toBeGreaterThan(100);
    expect(px(1)[0]).toBeGreaterThan(200); expect(px(1)[1]).toBeLessThan(10);
    expect(px(3)[0]).toBeGreaterThan(200); expect(px(3)[1]).toBeLessThan(10);
  });

  it('XOR combine blends where A xor B', () => {
    const bus = mkBus();
    const ppu = setupBG2Main_BG1Sub(bus);
    // A [0..2], B [2..4]
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x02);
    w8(bus, mmio(0x28), 0x02); w8(bus, mmio(0x29), 0x04);
    w8(bus, mmio(0x23), 0x0c);
    w8(bus, mmio(0x30), 0x01 | (2 << 6));

    const rgba = renderMainScreenRGBA(ppu, 6, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    expect(px(1)[0]).toBeGreaterThan(100); expect(px(1)[1]).toBeGreaterThan(100);
    expect(px(2)[0]).toBeGreaterThan(200); expect(px(2)[1]).toBeLessThan(10);
    expect(px(4)[0]).toBeGreaterThan(100); expect(px(4)[1]).toBeGreaterThan(100);
  });

  it('XNOR combine blends where both-in or both-out', () => {
    const bus = mkBus();
    const ppu = setupBG2Main_BG1Sub(bus);
    // A [0..2], B [2..4]
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x02);
    w8(bus, mmio(0x28), 0x02); w8(bus, mmio(0x29), 0x04);
    w8(bus, mmio(0x23), 0x0c);
    w8(bus, mmio(0x30), 0x01 | (3 << 6));

    const rgba = renderMainScreenRGBA(ppu, 7, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    expect(px(2)[0]).toBeGreaterThan(100); expect(px(2)[1]).toBeGreaterThan(100);
    expect(px(5)[0]).toBeGreaterThan(100); expect(px(5)[1]).toBeGreaterThan(100);
    expect(px(1)[0]).toBeGreaterThan(200); expect(px(1)[1]).toBeLessThan(10);
  });
});

