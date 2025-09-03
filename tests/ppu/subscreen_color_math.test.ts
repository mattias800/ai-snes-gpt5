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

describe('Subscreen + per-layer color math masks (simplified)', () => {
  it('applies color math only when the main layer is selected in CGADSUB mask and uses TS subscreen', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Full brightness
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);

    // BG1 on main (TM bit0), BG2 on subscreen (TS bit1)
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x2d), 0x02);

    // BG1 char base 0x1000, tile1 solid (pix=1), map at 0
    w8(bus, mmio(0x07), 0x00);
    // Set BG1 and BG2 char bases to 0x1000 so both layers use the same tile graphics
    w8(bus, mmio(0x0b), 0x22);
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
    // BG1 tilemap at VRAM 0x0000
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x00);
    w8(bus, mmio(0x18), 0x01);
    w8(bus, mmio(0x19), 0x00);

    // BG2 tilemap: place at a different base (0x0400 bytes => word 0x0200)
    // and set palette group 1 (bits10-12), so color index becomes 16+pix
    w8(bus, mmio(0x08), 0x04); // BG2SC map base = 0x0400 bytes
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x02);
    w8(bus, mmio(0x18), 0x01);
    w8(bus, mmio(0x19), 0x04); // palette group 1

    // Palette: BG1 uses index 1 -> red; BG2 uses index 17 -> green
    // BG1 index 1 = red
    w8(bus, mmio(0x21), 2);
    w8(bus, mmio(0x22), 0x00);
    w8(bus, mmio(0x22), 0x7c);
    // BG2 index 17 = green (write little-endian at byte address 34)
    w8(bus, mmio(0x21), 34);
    w8(bus, mmio(0x22), 0xe0);
    w8(bus, mmio(0x22), 0x03);

    // Enable color math: add-half, global enable; select mask only BG1 (bit0)
    w8(bus, mmio(0x31), 0x61 | 0x20); // bit6=1 half, bit5=1 enable, bit0=1 selects BG1

    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    // Result should be roughly (red + green) / 2, giving both R and G > 0
    expect(rgba[0]).toBeGreaterThan(100); // red channel
    expect(rgba[1]).toBeGreaterThan(100); // green channel
  });
});

