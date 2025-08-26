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

describe('Mixed main/sub gating with wrap-around windows and subGate', () => {
  it('applyInside=1: blend only in intersection A∩B; main-only yields half red; sub-only yields pure red', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // BG1 main, BG2 subscreen
    w8(bus, mmio(0x00), 0x0f);
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x2d), 0x02);
    w8(bus, mmio(0x0b), 0x22);
    w8(bus, mmio(0x08), 0x04);

    writeSolid(bus);
    // BG1 red, BG2 green tiles
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x02); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);

    // Palettes
    w8(bus, mmio(0x21), 2);  w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);

    // Windows: A wrap [6..1] for main; B [1..4] for sub
    w8(bus, mmio(0x26), 0x06); w8(bus, mmio(0x27), 0x01);
    w8(bus, mmio(0x28), 0x01); w8(bus, mmio(0x29), 0x04);
    // Enable BG1 A only (bit0) and BG2 B only (bit3)
    w8(bus, mmio(0x23), 0x01 | 0x08);

    // CGWSEL: applyInside=1, OR combine (irrelevant since A-only/B-only), sub gate ON
    w8(bus, mmio(0x30), 0x01 | 0x02 | (0 << 6));
    // Color math add-half, mask BG1
    w8(bus, mmio(0x31), 0x60 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];

    // Intersection at x=1 -> blend
    expect(px(1)[0]).toBeGreaterThan(100); expect(px(1)[1]).toBeGreaterThan(100);
    // Main-only region (e.g., x=7) -> half red per current subGate masking semantics
    expect(px(7)[0]).toBeGreaterThan(100); expect(px(7)[1]).toBeLessThan(20);
    // Sub-only region (e.g., x=3) -> main not affected -> pure red
    expect(px(3)[0]).toBeGreaterThan(200); expect(px(3)[1]).toBeLessThan(20);
  });
});

