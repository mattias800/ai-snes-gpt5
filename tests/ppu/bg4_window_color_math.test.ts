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

describe('BG4 window gating (2bpp like BG3) with color math', () => {
  it('applyInside=1: window A enables blend over BG4 main', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Full brightness
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 0 (all BGs are 2bpp, supports BG1-4)
    w8(bus, mmio(0x05), 0x00);
    // Enable BG4 main and BG2 subscreen
    w8(bus, mmio(0x2c), 0x08);
    w8(bus, mmio(0x2d), 0x02);

    // BG4 map base 0 ($210A), BG34NBA ($210C): BG4 uses HIGH nibble
    w8(bus, mmio(0x0a), 0x00); // map base 0
    w8(bus, mmio(0x0c), 0x10); // BG4 char base nibble=1 -> 0x1000 words; BG3 nibble=0

    // BG2 map/char for subscreen green; place BG2 tilemap at word 0x0200 to avoid overlap with BG4 tilemap
    w8(bus, mmio(0x08), 0x04); // map base offset -> word 0x0200
    w8(bus, mmio(0x0b), 0x11);

    // Make BG4 tile 0 solid index 1
    writeBG4SolidTile0(bus, 0x1000);

    // BG4 tilemap entry 0 -> tile 0, pal group 0
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x00); w8(bus, mmio(0x19), 0x00);
    // BG2 tilemap entry at word 0x0200 -> tile 1 pal group 1 (solid will be index1 too)
    // Write BG2 solid tile 1 (2bpp)
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x1000 + 16 + y*2) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + y*2) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff);
      w8(bus, mmio(0x19), 0x00);
      w8(bus, mmio(0x16), (0x1000 + 16 + y*2 + 1) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + y*2 + 1) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x02); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);

    // CGRAM: index1 red, index17 green
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);

    // Window A [0..3], W34SEL enables BG4 A (bit2)
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x03);
    w8(bus, mmio(0x24), 0x04);
    // CGWSEL: applyInside=1, OR combine; subscreen gating on
    w8(bus, mmio(0x30), 0x01 | 0x02 | (0 << 6));

    // Color math enable add-half global (mask=0)
    w8(bus, mmio(0x31), 0x60);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // Inside window -> blend
    expect(px(1)[0]).toBeGreaterThan(100); expect(px(1)[1]).toBeGreaterThan(100);
    // Outside -> pure BG4 red
    expect(px(5)[0]).toBeGreaterThan(200); expect(px(5)[1]).toBeLessThan(10);
  });
});

