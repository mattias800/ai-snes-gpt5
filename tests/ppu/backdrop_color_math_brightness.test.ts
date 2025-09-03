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

function writeSolid(bus: SNESBus) {
  // Write tile 1 at char base 0x1000 words
  // For 4bpp, each tile is 32 bytes (16 words)
  // Tile 1 starts at 0x1000 + 16 words = 0x1010 words
  for (let y = 0; y < 8; y++) {
    // Each row is 2 words (4 bytes) for 4bpp
    // First byte: bitplane 0
    // Second byte: bitplane 1
    // Third byte: bitplane 2
    // Fourth byte: bitplane 3
    const addr = 0x1010 + y * 2;
    w8(bus, mmio(0x16), addr & 0xff);
    w8(bus, mmio(0x17), (addr >>> 8) & 0xff);
    // Set all pixels to palette index 1 (0x11 in bitplanes 0 and 1)
    w8(bus, mmio(0x18), 0xff); // bitplane 0: all 1s
    w8(bus, mmio(0x19), 0x00); // bitplane 1: all 0s
    w8(bus, mmio(0x16), (addr + 1) & 0xff);
    w8(bus, mmio(0x17), ((addr + 1) >>> 8) & 0xff);
    w8(bus, mmio(0x18), 0x00); // bitplane 2: all 0s
    w8(bus, mmio(0x19), 0x00); // bitplane 3: all 0s
  }
}

describe('Backdrop color math gating and brightness after math', () => {
  it('applies color math to backdrop when mask=0 and brightness scales after math', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Full brightness initially
    w8(bus, mmio(0x00), 0x0f);
    
    // Set BG mode 1 (BG1/BG2 are 4bpp)
    w8(bus, mmio(0x05), 0x01);

    // No main layers -> backdrop only
    w8(bus, mmio(0x2c), 0x00);
    // Subscreen BG1 present
    w8(bus, mmio(0x2d), 0x01);

    // Set backdrop (CGRAM index 0) to red 0x7C00
    w8(bus, mmio(0x21), 0); // index 0 low byte
    w8(bus, mmio(0x22), 0x00);
    w8(bus, mmio(0x22), 0x7c);

    // Setup BG1 green tile on subscreen
    w8(bus, mmio(0x07), 0x00); // BG1 map base 0
    w8(bus, mmio(0x0b), 0x02); // BG1 char base 0x1000 words
    writeSolid(bus);
    // BG1 tile 1 at map 0, palette group 0
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);
    // CGRAM index 1 = green 0x03E0
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);
    // Also set CGRAM index 5 in case it's being read from there
    w8(bus, mmio(0x21), 10); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);

    // Enable color math add-half globally; mask=0 (apply to all, including backdrop)
    w8(bus, mmio(0x31), 0x60);

    // Render with full brightness -> expect red+green blended/2 => both R and G notable
    const rgbaFull = renderMainScreenRGBA(ppu, 1, 1);
    const Rfull = rgbaFull[0];
    const Gfull = rgbaFull[1];
    
    expect(Rfull).toBeGreaterThan(100);
    expect(Gfull).toBeGreaterThan(100);

    // Set brightness to 0x08 (scale 8/15) and render again
    w8(bus, mmio(0x00), 0x08);
    const rgbaDim = renderMainScreenRGBA(ppu, 1, 1);

    // Expect approximately scaled by 8/15
    const scale = 8 / 15;
    const RdimExpected = Math.round(Rfull * scale);
    const GdimExpected = Math.round(Gfull * scale);
    // Allow small rounding tolerance
    expect(Math.abs(rgbaDim[0] - RdimExpected)).toBeLessThanOrEqual(1);
    expect(Math.abs(rgbaDim[1] - GdimExpected)).toBeLessThanOrEqual(1);
  });
});

