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

describe('Backdrop strict mask mode with mask=0 and bit5=0', () => {
  function setupBackdropWithSubGreen(bus: SNESBus) {
    const ppu = bus.getPPU();
    // Full brightness
    w8(bus, mmio(0x00), 0x0f);
    // No main layers -> backdrop only
    w8(bus, mmio(0x2c), 0x00);
    // Subscreen BG1 green
    w8(bus, mmio(0x2d), 0x01);
    // Set up CGRAM colors
    // Backdrop color (CGRAM index 0) = red 0x7C00
    w8(bus, mmio(0x21), 0);
    w8(bus, mmio(0x22), 0x00);
    w8(bus, mmio(0x22), 0x7c);
    // BG1 pixel value 1 color (CGRAM index 1) = green 0x03E0
    // CGADD is a byte index, so for color word 1, we need byte index 2
    w8(bus, mmio(0x21), 2);
    w8(bus, mmio(0x22), 0xe0); // Low byte
    w8(bus, mmio(0x22), 0x03); // High byte
    // BG1 green tile on subscreen
    w8(bus, mmio(0x07), 0x00);
    w8(bus, mmio(0x0b), 0x20); // BG1 base at 0x0000, BG2 base at 0x4000
    // Mode 0 uses 2bpp tiles, not 4bpp!
    // Write tile 1 graphics at character base 0x0000 + tile 1 offset (8 words for 2bpp)
    // VRAM word address 0x0008 (tile 1 starts at 8 words from base)
    for (let y = 0; y < 8; y++) {
      // For 2bpp: write plane 0 (bit 0) and plane 1 (bit 1) in a single word
      // Low byte = plane 0 (all pixels have bit 0 set for value 1)
      // High byte = plane 1 (all zeros)
      w8(bus, mmio(0x16), (0x0008 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x0008 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff); // Plane 0: all pixels have bit 0 set
      w8(bus, mmio(0x19), 0x00); // Plane 1: all zeros
    }
    // Write tilemap entry at VRAM 0x0000 to use tile 1
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);
    return ppu;
  }

  it('simplified default (strict=false): with bit5=0 and mask=0, no math applies (pure red)', () => {
    const bus = mkBus();
    const ppu = setupBackdropWithSubGreen(bus);
    (ppu as any).cgwStrictMaskMode = false;
    // CGADSUB: half add, mask=0 (global), but bit5=0 (no enable in simplified)
    w8(bus, mmio(0x31), 0x40);
    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    // Expect pure red from backdrop
    expect(rgba[0]).toBeGreaterThan(200);
    expect(rgba[1]).toBeLessThan(10);
  });

  it('strict=true: with bit5=0 and mask=0, math applies (blend red+green)', () => {
    const bus = mkBus();
    const ppu = setupBackdropWithSubGreen(bus);
    (ppu as any).cgwStrictMaskMode = true;
    w8(bus, mmio(0x31), 0x40); // half add, mask=0
    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    // Expect both R and G visible (blended)
    expect(rgba[0]).toBeGreaterThan(100);
    expect(rgba[1]).toBeGreaterThan(100);
  });
});

