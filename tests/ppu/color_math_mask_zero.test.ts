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

describe('Color math mask=0 (apply to all main layers)', () => {
  function writeSolidTile1(bus: SNESBus) {
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

  it('applies add-half to BG1 main with BG2 subscreen when mask=0', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Brightness and maps
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    w8(bus, mmio(0x07), 0x00);
    w8(bus, mmio(0x08), 0x04);
    w8(bus, mmio(0x0b), 0x11);
    writeSolidTile1(bus);

    // BG1 tilemap 0 -> tile1, pal0
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x00);
    w8(bus, mmio(0x18), 0x01);
    w8(bus, mmio(0x19), 0x00);
    // BG2 tilemap at word 0x0200 -> tile1, pal1
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x02);
    w8(bus, mmio(0x18), 0x01);
    w8(bus, mmio(0x19), 0x04);

    // Palettes: BG1 index1=red, BG2 index17=green
    w8(bus, mmio(0x21), 2);
    w8(bus, mmio(0x22), 0x00);
    w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34);
    w8(bus, mmio(0x22), 0xe0);
    w8(bus, mmio(0x22), 0x03);

    // Main=BG1, Sub=BG2
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x2d), 0x02);

    // CGADSUB: enable + half, mask=0 -> apply to all main layers
    w8(bus, mmio(0x31), 0x60 | 0x00);

    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    expect(rgba[0]).toBeGreaterThan(100);
    expect(rgba[1]).toBeGreaterThan(100);
    expect(rgba[2]).toBeLessThan(20);
  });
});

