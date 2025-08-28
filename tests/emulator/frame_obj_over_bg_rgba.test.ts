import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
import { renderMainScreenRGBA } from '../../src/ppu/bg';

const mmio = (reg: number) => (0x00 << 16) | (0x2100 + (reg & 0xff));
const w8 = (bus: SNESBus, addr: number, v: number) => bus.write8(addr, v & 0xff);

function mkBus() {
  const rom = new Uint8Array(0x20000);
  const cart = new Cartridge({ rom, mapping: 'lorom' });
  return new SNESBus(cart);
}

describe('Frame RGBA: OBJ over BG1 (priority, transparency)', () => {
  it('renders red OBJ over blue BG1 at (0,0) with OBJ priority high', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Unblank, enable BG1+OBJ
    w8(bus, mmio(0x00), 0x0f);
    w8(bus, mmio(0x2c), 0x11); // BG1 + OBJ on main

    // BG1: map base 0x0000, char base 0x0800 words; VMAIN +1 word
    w8(bus, mmio(0x07), 0x00);
    w8(bus, mmio(0x0b), 0x10);
    w8(bus, mmio(0x15), 0x00);

    // Write 4bpp tile 0 at 0x0800: solid palette index 1 (plane0=0xFF)
    const tileBaseWord = 0x0800;
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (tileBaseWord + y) & 0xff);
      w8(bus, mmio(0x17), ((tileBaseWord + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff);
      w8(bus, mmio(0x19), 0x00);
    }
    for (let y = 0; y < 8; y++) {
      const addr = tileBaseWord + 8 + y;
      w8(bus, mmio(0x16), addr & 0xff);
      w8(bus, mmio(0x17), (addr >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }
    // Tilemap (0,0) -> tile 0
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x00);
    w8(bus, mmio(0x18), 0x00);
    w8(bus, mmio(0x19), 0x00);

    // CGRAM: palette index 1 = blue max (BGR555: B=31)
    w8(bus, mmio(0x21), 0x02);
    w8(bus, mmio(0x22), 0x1f);
    w8(bus, mmio(0x22), 0x00);

    // OBJ: char base 0x1000 bytes (words offset set via OBSEL low nibble)
    w8(bus, mmio(0x01), 0x02); // low nibble=2 => word base 0x1000

    // Write OBJ tile index 1 at char base 0x1000 (solid red)
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x1000 + 16 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff);
      w8(bus, mmio(0x19), 0x00);
    }
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x1000 + 16 + 8 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + 8 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }

    // OAM: sprite at (0,0), tile=1, attr: priority high (bit5=1) and OBJ palette group 1 (bits1-3=001)
    w8(bus, mmio(0x02), 0x00); // OAMADDL=0
    w8(bus, mmio(0x03), 0x00); // OAMADDH=0
    w8(bus, mmio(0x04), 0x00); // y
    w8(bus, mmio(0x04), 0x00); // x low
    w8(bus, mmio(0x04), 0x01); // tile index 1
    w8(bus, mmio(0x04), 0x22); // attr: priority high + palette group 1

    // OBJ palette group 1, index 1 = CGRAM entry 16+1=17 -> red max
    w8(bus, mmio(0x21), 0x22);
    w8(bus, mmio(0x22), 0x00);
    w8(bus, mmio(0x22), 0x7c);

    const W = 16, H = 16;
    const rgba = renderMainScreenRGBA(ppu, W, H);

    // (0,0) should be red (OBJ high priority)
    expect(rgba[0]).toBeGreaterThan(200);
    expect(rgba[1]).toBeLessThan(50);
    expect(rgba[2]).toBeLessThan(50);

    // (8,0) should be background (blue), as sprite is 8x8 at (0..7,0..7)
    const o = (0 * W + 8) * 4;
    expect(rgba[o + 0]).toBeLessThan(50);
    expect(rgba[o + 1]).toBeLessThan(50);
    expect(rgba[o + 2]).toBeGreaterThan(200);
  });
});
