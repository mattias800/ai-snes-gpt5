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
  // Write 2bpp tile data for BG4 (mode 0 uses 2bpp for all BGs)
  for (let y = 0; y < 8; y++) {
    // Plane 0: all bits set (0xff)
    w8(bus, mmio(0x16), ((charBaseWords + y*2) & 0xff));
    w8(bus, mmio(0x17), (((charBaseWords + y*2) >>> 8) & 0xff));
    w8(bus, mmio(0x18), 0xff);
    w8(bus, mmio(0x19), 0x00);
    // Plane 1: all bits clear (0x00)
    w8(bus, mmio(0x16), ((charBaseWords + y*2 + 1) & 0xff));
    w8(bus, mmio(0x17), (((charBaseWords + y*2 + 1) >>> 8) & 0xff));
    w8(bus, mmio(0x18), 0x00);
    w8(bus, mmio(0x19), 0x00);
  }
}

describe('BG4 color math mask (per-layer) behavior', () => {
  function setup(bus: SNESBus) {
    const ppu = bus.getPPU();
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 0 (all BGs are 2bpp, supports BG1-4)
    w8(bus, mmio(0x05), 0x00);
    // BG4 main, BG2 sub
    w8(bus, mmio(0x2c), 0x08);
    w8(bus, mmio(0x2d), 0x02);
    // BG4 map base 0, char base 0x1000 (BG34NBA: high nibble = BG4)
    w8(bus, mmio(0x0a), 0x00); w8(bus, mmio(0x0c), 0x20);
    // BG2 map base 0x0200, char base 0x1000
    w8(bus, mmio(0x08), 0x04); w8(bus, mmio(0x0b), 0x20);
    // Data
    writeBG4SolidTile0(bus, 0x1000);
    // Write BG2 solid tile 1 (2bpp)
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x1000 + 16 + y*2) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + y*2) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff); w8(bus, mmio(0x19), 0x00);
      w8(bus, mmio(0x16), (0x1000 + 16 + y*2 + 1) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + y*2 + 1) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00); w8(bus, mmio(0x19), 0x00);
    }
    // BG4 tilemap at 0, BG2 tilemap at word 0x0200
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x00); w8(bus, mmio(0x19), 0x00);
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x02); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);
    // Palettes: index1 red; index17 green
    w8(bus, mmio(0x21), 2);  w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);
    return ppu;
  }

  it('mask selects BG4: add-half applies (R and G noticeable)', () => {
    const bus = mkBus();
    const ppu = setup(bus);
    // Enable color math add-half; mask=BG4 bit3
    w8(bus, mmio(0x31), 0x60 | 0x08);
    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    expect(rgba[0]).toBeGreaterThan(100); // R
    expect(rgba[1]).toBeGreaterThan(100); // G
  });

  it('mask selects BG1 only: no math when main is BG4 (pure red)', () => {
    const bus = mkBus();
    const ppu = setup(bus);
    // Color math add-half; mask=BG1
    w8(bus, mmio(0x31), 0x60 | 0x01);
    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    expect(rgba[0]).toBeGreaterThan(200);
    expect(rgba[1]).toBeLessThan(20);
  });
});

