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

function writeBG2SolidTile1(bus: SNESBus) {
  // Write 2bpp tile data for BG2
  for (let y = 0; y < 8; y++) {
    // Plane 0: all bits set (0xff)
    w8(bus, mmio(0x16), (0x1000 + 16 + y*2) & 0xff);
    w8(bus, mmio(0x17), ((0x1000 + 16 + y*2) >>> 8) & 0xff);
    w8(bus, mmio(0x18), 0xff);
    w8(bus, mmio(0x19), 0x00);
    // Plane 1: all bits clear (0x00)
    w8(bus, mmio(0x16), (0x1000 + 16 + y*2 + 1) & 0xff);
    w8(bus, mmio(0x17), ((0x1000 + 16 + y*2 + 1) >>> 8) & 0xff);
    w8(bus, mmio(0x18), 0x00);
    w8(bus, mmio(0x19), 0x00);
  }
}

describe('BG4 window wrap-around behavior', () => {
  it('OR combine with wrap-around A: A[6..1] blends for x=6,7,0,1; outside no blend', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Setup BG4 main, BG2 sub
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 0 (all BGs are 2bpp, supports BG1-4)
    w8(bus, mmio(0x05), 0x00);
    w8(bus, mmio(0x2c), 0x08);
    w8(bus, mmio(0x2d), 0x02);
    w8(bus, mmio(0x0a), 0x00); // BG4 map base 0
    w8(bus, mmio(0x0c), 0x10); // BG4 char 0x0800
    w8(bus, mmio(0x08), 0x04); // BG2 map base word 0x0200
    w8(bus, mmio(0x0b), 0x11); // BG2 char 0x1000

    writeBG4SolidTile0(bus, 0x1000);
    writeBG2SolidTile1(bus);

    // BG4 tile0 at map 0; BG2 tile1 at word 0x0200
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x00); w8(bus, mmio(0x19), 0x00);
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x02); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);

    // Palettes: red (index1) and green (index17)
    w8(bus, mmio(0x21), 2);  w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);

    // Color math add-half; mask BG4
    w8(bus, mmio(0x31), 0x60 | 0x08);

    // Window A wrap-around [6..1]; enable BG4 A; OR combine; sub gate on
    w8(bus, mmio(0x26), 0x06); w8(bus, mmio(0x27), 0x01);
    w8(bus, mmio(0x24), 0x04);
    w8(bus, mmio(0x30), 0x01 | 0x02 | (0 << 6));

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // Inside wrap -> blend at 6,7,0,1
    expect(px(6)[0]).toBeGreaterThan(100); expect(px(6)[1]).toBeGreaterThan(100);
    expect(px(1)[0]).toBeGreaterThan(100); expect(px(1)[1]).toBeGreaterThan(100);
    // Outside -> pure red at x=3
    expect(px(3)[0]).toBeGreaterThan(200); expect(px(3)[1]).toBeLessThan(20);
  });
});

