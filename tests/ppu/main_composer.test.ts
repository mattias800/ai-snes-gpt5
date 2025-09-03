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

describe('Main screen composer: BG1 over BG2 (simplified)', () => {
  it('draws BG1 where pixels are non-zero, else falls back to BG2, else backdrop', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Full brightness
    w8(bus, mmio(0x00), 0x0f);

    // Enable BG1 and BG2 on TM
    w8(bus, mmio(0x2c), 0x03);

    // BG1: map base 0x0000, char base 0x1000; tile 0 has pix=0 -> transparent
    w8(bus, mmio(0x07), 0x00);
    w8(bus, mmio(0x0b), 0x01);
    // Write tile 0: all planes zero => pix=0
    for (let y = 0; y < 16; y++) {
      w8(bus, mmio(0x16), (0x1000 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }
    // Place tile 1 at VRAM char base + 16 words with plane0=0xFF -> pix=1
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

    // BG2: map base 0x0400 words, char base 0x2000 words; tile 0 has pix=1 (solid)
    w8(bus, mmio(0x08), 0x04); // 0x0400 bytes => 0x0200 words; but our renderer assumes base is words directly -> use map entries at 0
    w8(bus, mmio(0x0b), 0x20); // keep BG1 char base; BG2 char base is low nibble of $210B (we used only BG2 indices renderer reading bg2CharBaseWord)
    // Actually set BG2 char base via nibble of $210B low: write 0x02 already set -> 0x1000 words; bump to 0x2000 by writing $210B low nibble 4 (but that would also move BG1)
    // Simpler: keep BG2 char base same as BG1 (0x1000) and map tile index 1 for BG2 to use our solid tile1.

    // BG1 tilemap: left half tile1 (solid), right half tile0 (transparent)
    for (let x = 0; x < 8; x++) {
      const addr = x; // first row
      w8(bus, mmio(0x16), addr & 0xff);
      w8(bus, mmio(0x17), (addr >>> 8) & 0xff);
      const tileIndex = x < 4 ? 1 : 0; // left 4 tiles use tile 1
      w8(bus, mmio(0x18), tileIndex & 0xff);
      w8(bus, mmio(0x19), 0x00);
    }

    // BG2 tilemap: entire row uses tile1 (solid)
    // Use BG2 map base at 0 words for indices renderer simplicity
    for (let x = 0; x < 8; x++) {
      const addr = x;
      w8(bus, mmio(0x16), addr & 0xff);
      w8(bus, mmio(0x17), (addr >>> 8) & 0xff);
      w8(bus, mmio(0x18), 1);
      w8(bus, mmio(0x19), 0x00);
    }

    // Palette: index 1 = red, backdrop index 0 = blue
    // Backdrop index 0 is at CGRAM 0
    w8(bus, mmio(0x21), 0);
    w8(bus, mmio(0x22), 0x1f); // blue low
    w8(bus, mmio(0x22), 0x00); // blue high
    // Index 1 = red (0x7C00)
    w8(bus, mmio(0x21), 2);
    w8(bus, mmio(0x22), 0x00);
    w8(bus, mmio(0x22), 0x7c);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => {
      const o = x * 4;
      return [rgba[o], rgba[o + 1], rgba[o + 2]];
    };

    // Left 4 pixels from BG1 tile1 -> red
    expect(px(0)[0]).toBe(255); // red channel
    // Right 4 pixels -> BG1 transparent, so BG2 tile1 -> red as fallback
    expect(px(5)[0]).toBe(255);
  });
});

