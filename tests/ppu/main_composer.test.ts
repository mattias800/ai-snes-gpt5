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
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);

    // Enable BG1 and BG2 on TM
    w8(bus, mmio(0x2c), 0x03);

    // BG1: map base 0x0000, char base 0x1000
    w8(bus, mmio(0x07), 0x00);
    // BG12NBA: low nibble=BG1, high nibble=BG2. Set BG1=0x1000, BG2=0x2000
    w8(bus, mmio(0x0b), 0x42);
    // Write tile 0: all planes zero => pix=0
    for (let y = 0; y < 16; y++) {
      w8(bus, mmio(0x16), (0x1000 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }
    // Place tile 1 at VRAM char base + 16 words (4bpp tile)
    // First 8 words: plane0/1 pairs for rows 0-7
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x1000 + 16 + y*2) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + y*2) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff); // plane0 = 0xFF (all bits set)
      w8(bus, mmio(0x19), 0x00); // plane1 = 0x00
    }
    // Next 8 words: plane2/3 pairs for rows 0-7  
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x1000 + 16 + 8 + y*2) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + 8 + y*2) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00); // plane2 = 0x00
      w8(bus, mmio(0x19), 0x00); // plane3 = 0x00
    }

    // BG2: map base 0x0400 words (register takes offset in 1KB chunks)
    // BG2SC register: bits 2-7 = base offset in 1KB units = 0x400 bytes = 0x200 words
    // To set map base at word 0x200, we need value 0x04 (0x04 << 10 bytes = 0x1000 bytes = 0x800 words)
    // Actually the encoding is: (value & 0xFC) << 8 = base in bytes. So 0x04 -> 0x400 bytes = 0x200 words
    w8(bus, mmio(0x08), 0x04);
    // BG2 char base is already set to 0x2000 via BG12NBA above

    // BG1 tilemap: left half tile1 (solid), right half tile0 (transparent)
    for (let x = 0; x < 8; x++) {
      const addr = x; // first row
      w8(bus, mmio(0x16), addr & 0xff);
      w8(bus, mmio(0x17), (addr >>> 8) & 0xff);
      const tileIndex = x < 4 ? 1 : 0; // left 4 tiles use tile 1
      w8(bus, mmio(0x18), tileIndex & 0xff);
      w8(bus, mmio(0x19), 0x00);
    }

    // Also write tile 1 at BG2 char base (0x2000)
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x2000 + 16 + y*2) & 0xff);
      w8(bus, mmio(0x17), ((0x2000 + 16 + y*2) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff); // plane0 = 0xFF
      w8(bus, mmio(0x19), 0x00); // plane1 = 0x00
    }
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x2000 + 16 + 8 + y*2) & 0xff);
      w8(bus, mmio(0x17), ((0x2000 + 16 + 8 + y*2) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00); // plane2 = 0x00
      w8(bus, mmio(0x19), 0x00); // plane3 = 0x00
    }
    
    // BG2 tilemap: entire row uses tile1 (solid)
    // BG2 map base is at word 0x200
    for (let x = 0; x < 8; x++) {
      const addr = 0x200 + x;
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

