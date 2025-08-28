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

describe('Frame RGBA: OBJ subtract-half with fixed color inside window only', () => {
  it('inside window reduces red (OBJ) due to subtract-half; outside full red', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Unblank, enable OBJ only on main screen
    w8(bus, mmio(0x00), 0x0f);
    w8(bus, mmio(0x2c), 0x10);

    // OBSEL: char base word 0x1000; 8x8 sprites
    w8(bus, mmio(0x01), 0x02);

    // Write OBJ tile index 1: red solid (plane0=0xff rows)
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

    // OAM: sprite at (0,0), tile=1, attr palette group 1 (bits1-3=001), high priority
    w8(bus, mmio(0x02), 0x00); // OAMADDL
    w8(bus, mmio(0x03), 0x00); // OAMADDH
    w8(bus, mmio(0x04), 0x00); // Y
    w8(bus, mmio(0x04), 0x00); // X
    w8(bus, mmio(0x04), 0x01); // tile=1
    w8(bus, mmio(0x04), 0x22); // attr: prio high + pal group 1

    // OBJ palette group 1, index 1 => CGRAM 17 = red max
    w8(bus, mmio(0x21), 0x22);
    w8(bus, mmio(0x22), 0x00);
    w8(bus, mmio(0x22), 0x7c);

    // Fixed color: blue 31
    w8(bus, mmio(0x32), 0x80 | 31);
    // CGADSUB: subtract + half (bit7=1, bit6=1); mask=0 -> apply to all
    w8(bus, mmio(0x31), 0xC0);

    // Window: applyInside (CGWSEL bit0=1), fixed-as-sub (bit2=1): restrict to x in [0..3]
    // Enable window A for OBJ via WOBJSEL bit0
    w8(bus, mmio(0x25), 0x01); // WOBJSEL
    w8(bus, mmio(0x26), 0x00); // WH0
    w8(bus, mmio(0x27), 0x03); // WH1
    w8(bus, mmio(0x30), 0x04 | 0x01);

    const W = 16, H = 8;
    const rgba = renderMainScreenRGBA(ppu, W, H);

    // Inside window x=1 should be reduced red (still >60, well below >200)
    const inside = (0 * W + 1) * 4;
    expect(rgba[inside + 0]).toBeGreaterThan(60);
    expect(rgba[inside + 0]).toBeLessThan(200);

    // Outside window but still inside sprite: x=6 should be full red (>200)
    const outside = (0 * W + 6) * 4;
    expect(rgba[outside + 0]).toBeGreaterThan(200);
  });
});
