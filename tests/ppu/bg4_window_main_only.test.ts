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

describe('BG4 window gating main-only (no subscreen gating)', () => {
  it('applyInside=1: window A enables add-half against fixed sub (no sub gate)', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Brightness
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 0 (all BGs are 2bpp, supports BG1-4)
    w8(bus, mmio(0x05), 0x00);

    // Enable BG4 on main only; no subscreen layers
    w8(bus, mmio(0x2c), 0x08);
    w8(bus, mmio(0x2d), 0x00);

    // BG4 map base 0, char base 0x0800 words
    w8(bus, mmio(0x0a), 0x00);
    w8(bus, mmio(0x0c), 0x20);

    // Write BG4 solid tile0
    writeBG4SolidTile0(bus, 0x1000);

    // Tilemap entry 0 -> tile 0
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x00); w8(bus, mmio(0x19), 0x00);

    // Palettes: index1 red
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);

    // Use fixed color as subscreen (green) via CGWSEL bit2; do NOT set sub gate (bit1)
    w8(bus, mmio(0x30), 0x04 | 0x01); // applyInside=1, fixed mode on, sub gate off
    w8(bus, mmio(0x32), 0x40 | 31); // fixed G = 31

    // Color math: enable + half; mask=0 (all)
    w8(bus, mmio(0x31), 0x60);

    // Window A [0..3] enabled for BG4 in W34SEL
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x03);
    w8(bus, mmio(0x24), 0x04);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // Inside window -> blend red+green/2
    expect(px(1)[0]).toBeGreaterThan(80); expect(px(1)[1]).toBeGreaterThan(80);
    // Outside window -> no math (pure red)
    expect(px(5)[0]).toBeGreaterThan(200); expect(px(5)[1]).toBeLessThan(20);
  });
});

