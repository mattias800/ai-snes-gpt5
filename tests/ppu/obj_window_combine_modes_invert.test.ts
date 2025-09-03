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

function writeObjSolidTile(bus: SNESBus) {
  for (let y = 0; y < 8; y++) {
    w8(bus, mmio(0x16), (0x1000 + 16 + y) & 0xff);
    w8(bus, mmio(0x17), ((0x1000 + 16 + y) >>> 8) & 0xff);
    w8(bus, mmio(0x18), 0xff); w8(bus, mmio(0x19), 0x00);
    w8(bus, mmio(0x16), (0x1000 + 16 + 8 + y) & 0xff);
    w8(bus, mmio(0x17), ((0x1000 + 16 + 8 + y) >>> 8) & 0xff);
    w8(bus, mmio(0x18), 0x00); w8(bus, mmio(0x19), 0x00);
  }
}

describe('OBJ window combine with invert and sub gating', () => {
  function setup(bus: SNESBus) {
    const ppu = bus.getPPU();
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    // OBJ main, BG2 subscreen green
    w8(bus, mmio(0x2c), 0x10);
    w8(bus, mmio(0x2d), 0x02);
    // OBJ char base 0x1000, sprite at (0,0)
    w8(bus, mmio(0x01), 0x02);
    writeObjSolidTile(bus);
    w8(bus, mmio(0x02), 0x00);
    w8(bus, mmio(0x04), 0x00); w8(bus, mmio(0x04), 0x00); w8(bus, mmio(0x04), 0x01); w8(bus, mmio(0x04), 0x00);
    // BG2 map 0x0000, char 0x1000, tile1 pal group1
    w8(bus, mmio(0x08), 0x00); w8(bus, mmio(0x0b), 0x22);
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);
    // Palettes: OBJ index1 red; BG2 index17 green
    w8(bus, mmio(0x21), 2);  w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);
    // Color math add-half; mask selects OBJ
    w8(bus, mmio(0x31), 0x60 | 0x10);
    return ppu;
  }

  it('XNOR + invert A behaves like XOR (blend where exactly one active)', () => {
    const bus = mkBus();
    const ppu = setup(bus);
    // Windows: A [0..2], B [2..4]; enable OBJ A|B and invert A
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x02);
    w8(bus, mmio(0x28), 0x02); w8(bus, mmio(0x29), 0x04);
    w8(bus, mmio(0x25), 0x03 | 0x10);
    // CGWSEL: applyInside=1, XNOR, sub gate ON
    w8(bus, mmio(0x30), 0x01 | 0x02 | (3 << 6));

    const rgba = renderMainScreenRGBA(ppu, 6, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    expect(px(1)[0]).toBeGreaterThan(100); expect(px(1)[1]).toBeGreaterThan(100); // A-only
    expect(px(2)[0]).toBeGreaterThan(200); expect(px(2)[1]).toBeLessThan(20);     // overlap
    expect(px(4)[0]).toBeGreaterThan(100); expect(px(4)[1]).toBeGreaterThan(100); // B-only
  });

  it('XOR with invert B blends in overlap and outside-both regions', () => {
    const bus = mkBus();
    const ppu = setup(bus);
    // A [0..2], B [2..4]; enable OBJ A|B and invert B
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x02);
    w8(bus, mmio(0x28), 0x02); w8(bus, mmio(0x29), 0x04);
    w8(bus, mmio(0x25), 0x03 | 0x20);
    // CGWSEL: applyInside=1, XOR, sub gate OFF
    w8(bus, mmio(0x30), 0x01 | (2 << 6));

    const rgba = renderMainScreenRGBA(ppu, 7, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // With invert-B + XOR: blend at overlap (x=2) and outside both (x=5)
    expect(px(2)[0]).toBeGreaterThan(100); expect(px(2)[1]).toBeGreaterThan(100);
    expect(px(5)[0]).toBeGreaterThan(100); expect(px(5)[1]).toBeGreaterThan(100);
    // No blend in A-only (x=1) or B-only (x=3)
    expect(px(1)[0]).toBeGreaterThan(200); expect(px(1)[1]).toBeLessThan(20);
    expect(px(3)[0]).toBeGreaterThan(200); expect(px(3)[1]).toBeLessThan(20);
  });
});

