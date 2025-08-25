import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
import { renderBG1RegionRGBA } from '../../src/ppu/bg';

const mmio = (reg: number) => (0x00 << 16) | (0x2100 + (reg & 0xff));
const w8 = (bus: SNESBus, addr: number, v: number) => bus.write8(addr, v);

function mkBus() {
  const rom = new Uint8Array(0x20000);
  const cart = new Cartridge({ rom, mapping: 'lorom' });
  return new SNESBus(cart);
}

describe('BG1 RGBA render with CGRAM colors', () => {
  it('renders a 2x2 tile region with palette group mapping to colors', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Set BG1 map base at 0x0000, char base at 0x1000
    w8(bus, mmio(0x07), 0x00);
    w8(bus, mmio(0x0b), 0x20);

    // Build a tile with plane0 bit pattern 0xF0 (11110000) for row 0..7 -> left half 1s, right half 0s
    w8(bus, mmio(0x15), 0x00);
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x1000 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xf0); // plane0
      w8(bus, mmio(0x19), 0x00); // plane1
      w8(bus, mmio(0x16), (0x1000 + 8 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 8 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }

    // Tilemap: 2x2 with palette groups 0,1,2,3
    function writeMapWord(wordAddr: number, value: number) {
      w8(bus, mmio(0x16), wordAddr & 0xff);
      w8(bus, mmio(0x17), (wordAddr >>> 8) & 0xff);
      w8(bus, mmio(0x18), value & 0xff);
      w8(bus, mmio(0x19), (value >>> 8) & 0xff);
    }
    const pal = (g: number) => (g & 7) << 10; // palette group field in tilemap
    writeMapWord(0, pal(0));
    writeMapWord(1, pal(1));
    writeMapWord(32, pal(2));
    writeMapWord(33, pal(3));

    // CGRAM: set palette entries for index 1, 17, 33, 49 to distinct colors
    function writeCGRAMByte(index: number, byte: number) {
      w8(bus, mmio(0x21), index & 0xff);
      w8(bus, mmio(0x22), byte & 0xff);
    }
    // Index calculation: palGroup*16 + pix (pix=1). We'll set:
    // 1 -> Blue max, 17 -> Green max, 33 -> Red max, 49 -> White-ish (all max)
    // CGRAM stores little-endian BGR15
    // Blue max = 0x001F, Green max = 0x03E0, Red max = 0x7C00, White-ish ~ 0x7FFF
    function writeCGRAMWord(idx: number, word: number) {
      writeCGRAMByte(idx * 2 + 0, word & 0xff);
      writeCGRAMByte(idx * 2 + 1, (word >>> 8) & 0xff);
    }
    writeCGRAMWord(1, 0x001f);
    writeCGRAMWord(17, 0x03e0);
    writeCGRAMWord(33, 0x7c00);
    writeCGRAMWord(49, 0x7fff);

    const rgba = renderBG1RegionRGBA(ppu, 16, 16);

    // Check four quadrant representative pixels: (0,0)->pal0 pix1 -> blue; (8,0)->pal1 pix1 -> green
    // (0,8)->pal2 pix1 -> red; (8,8)->pal3 pix1 -> white-ish
    const px = (x: number, y: number) => {
      const o = (y * 16 + x) * 4;
      return [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]];
    };

    expect(px(0, 0)[2]).toBe(255); // blue channel
    expect(px(8, 0)[1]).toBe(255); // green channel
    expect(px(0, 8)[0]).toBe(255); // red channel
    // white-ish has all channels high
    const w = px(8, 8);
    expect(w[0]).toBe(255);
    expect(w[1]).toBe(255);
    expect(w[2]).toBe(255);
    expect(w[3]).toBe(255);
  });
});

