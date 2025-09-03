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

describe('OBJ wrap-around windows with invert and clip/prevent modes', () => {
  function setup(bus: SNESBus) {
    const ppu = bus.getPPU();
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    // OBJ main, BG2 subscreen
    w8(bus, mmio(0x2c), 0x10);
    w8(bus, mmio(0x2d), 0x02);
    // OBJ char base 0x1000, one sprite at (0,0) tile1
    w8(bus, mmio(0x01), 0x02);
    writeObjSolidTile(bus);
    w8(bus, mmio(0x02), 0x00);
    w8(bus, mmio(0x04), 0x00); w8(bus, mmio(0x04), 0x00); w8(bus, mmio(0x04), 0x01); w8(bus, mmio(0x04), 0x00);
    // BG2 green background (tile1 pal group1 at map 0)
    w8(bus, mmio(0x0b), 0x22); // BG2 char 0x1000
    w8(bus, mmio(0x08), 0x00); // BG2 map 0
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);
    // Palettes: OBJ red (index1), BG2 green (index17)
    w8(bus, mmio(0x21), 2);  w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);
    // Color math add-half, mask selects OBJ
    w8(bus, mmio(0x31), 0x60 | 0x10);
    return ppu;
  }

  it('wrap-around + clip-to-black: with applyInside=1, outside non-math side is black', () => {
    const bus = mkBus();
    const ppu = setup(bus);
    // Window A wrap [6..1]; enable OBJ A
    w8(bus, mmio(0x26), 0x06); w8(bus, mmio(0x27), 0x01);
    w8(bus, mmio(0x25), 0x01);
    // CGWSEL: applyInside=1, OR combine, sub gate on, clip-to-black on
    w8(bus, mmio(0x30), 0x01 | 0x02 | 0x08 | (0 << 6));

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1], rgba[x*4+2]];
    // Inside wrap (x=0 or 7) -> blend red+green
    expect(px(0)[0]).toBeGreaterThan(100); expect(px(0)[1]).toBeGreaterThan(100);
    expect(px(7)[0]).toBeGreaterThan(100); expect(px(7)[1]).toBeGreaterThan(100);
    // Outside wrap (x=4) -> clipped to black
    expect(px(4)[0]).toBeLessThan(10); expect(px(4)[1]).toBeLessThan(10); expect(px(4)[2]).toBeLessThan(10);
  });

  it('wrap-around + prevent-math: with applyInside=1, outside shows pure OBJ color (no blend)', () => {
    const bus = mkBus();
    const ppu = setup(bus);
    // Window A wrap [6..1]; enable OBJ A
    w8(bus, mmio(0x26), 0x06); w8(bus, mmio(0x27), 0x01);
    w8(bus, mmio(0x25), 0x01);
    // CGWSEL: applyInside=1, OR combine, sub gate on, clip off
    w8(bus, mmio(0x30), 0x01 | 0x02 | (0 << 6));

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // Inside -> blend
    expect(px(0)[0]).toBeGreaterThan(100); expect(px(0)[1]).toBeGreaterThan(100);
    // Outside (x=4) -> pure red
    expect(px(4)[0]).toBeGreaterThan(200); expect(px(4)[1]).toBeLessThan(20);
  });

  it('XNOR + invert A with wrap-around behaves like XOR on original windows', () => {
    const bus = mkBus();
    const ppu = setup(bus);
    // A [6..7], B [0..1]
    w8(bus, mmio(0x26), 0x06); w8(bus, mmio(0x27), 0x07);
    w8(bus, mmio(0x28), 0x00); w8(bus, mmio(0x29), 0x01);
    // Enable OBJ A|B and invert A
    w8(bus, mmio(0x25), 0x03 | 0x10);
    // CGWSEL: applyInside=1, XNOR, sub gate ON
    w8(bus, mmio(0x30), 0x01 | 0x02 | (3 << 6));

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // XOR(original A,B) -> blend at 6,7 and 0,1 only
    expect(px(6)[0]).toBeGreaterThan(100); expect(px(6)[1]).toBeGreaterThan(100);
    expect(px(0)[0]).toBeGreaterThan(100); expect(px(0)[1]).toBeGreaterThan(100);
    // Outside (x=3) -> no blend
    expect(px(3)[0]).toBeGreaterThan(200); expect(px(3)[1]).toBeLessThan(20);
  });
});

