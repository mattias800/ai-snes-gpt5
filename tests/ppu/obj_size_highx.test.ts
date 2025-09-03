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

describe('OBJ 16x16 size and high X support (minimal)', () => {
  function writeSolidTile(bus: SNESBus, baseWord: number, tileIndex: number, pattern: number) {
    for (let y = 0; y < 8; y++) {
      // plane0
      w8(bus, mmio(0x16), (baseWord + tileIndex * 16 + y) & 0xff);
      w8(bus, mmio(0x17), ((baseWord + tileIndex * 16 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), pattern);
      w8(bus, mmio(0x19), 0x00);
      // plane1
      w8(bus, mmio(0x16), (baseWord + tileIndex * 16 + 16 + y) & 0xff);
      w8(bus, mmio(0x17), ((baseWord + tileIndex * 16 + 16 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }
  }

  it('renders a 16x16 sprite composed from four subtiles', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    // OBSEL: base 0x1000 and 16x16 (bit4)
    w8(bus, mmio(0x01), 0x12); // low nibble 2 => 0x1000, bit4=1 size16

    // Create four subtiles for tile index 0x10 as base: 0x10,0x11,0x20,0x21
    // We'll just use tile base 0 and rely on subX/subY offsetting, so tile=0
    writeSolidTile(bus, 0x1000, 0, 0xff); // top-left solid
    writeSolidTile(bus, 0x1000, 1, 0x00); // top-right transparent
    writeSolidTile(bus, 0x1000, 16, 0x00); // bottom-left transparent
    writeSolidTile(bus, 0x1000, 17, 0xff); // bottom-right solid

    // Put sprite at (0,0), tile=0, high priority, group 0
    w8(bus, mmio(0x02), 0x00); // OAMADDL=0
    w8(bus, mmio(0x04), 0x00); // X low
    w8(bus, mmio(0x04), 0x00); // tile low
    w8(bus, mmio(0x04), 0x00); // tile=0
    w8(bus, mmio(0x04), 0x20); // attr pri=1

    // Enable OBJ
    w8(bus, mmio(0x2c), 0x10);

    // Palette index1 red
    w8(bus, mmio(0x21), 2);
    w8(bus, mmio(0x22), 0x00);
    w8(bus, mmio(0x22), 0x7c);

    const rgba = renderMainScreenRGBA(ppu, 16, 16);
    // Top-left (0,0) solid -> red
    expect(rgba[0]).toBeGreaterThan(200);
    // Bottom-right (15,15) solid -> red
    const o = (15 + 15 * 16) * 4;
    expect(rgba[o]).toBeGreaterThan(200);
    // Top-right (15,0) transparent -> black (backdrop)
    const o2 = (15 + 0 * 16) * 4;
    expect(rgba[o2]).toBeLessThan(20);
  });

  it('supports high X via attr bit0 (X += 256)', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    // 8x8 for simplicity here
    w8(bus, mmio(0x01), 0x02);
    writeSolidTile(bus, 0x1000, 1, 0xff);

    // Sprite at X=300: set low byte 44, then set OAM high table for sprite 0 bit0=1 (high X)
    w8(bus, mmio(0x02), 0x00);
    w8(bus, mmio(0x04), 0x00); // Y=0
    w8(bus, mmio(0x04), 44);  // X low
    w8(bus, mmio(0x04), 0x01); // tile=1
    w8(bus, mmio(0x04), 0x00); // attr
    // Write high table at OAM address 512 for sprite 0
    w8(bus, mmio(0x03), 0x02); // OAMADDH -> 0x200
    w8(bus, mmio(0x02), 0x00); // OAMADDL -> 0
    w8(bus, mmio(0x04), 0x01); // high X bit set

    // Enable OBJ
    w8(bus, mmio(0x2c), 0x10);

    // Palette index1 red
    w8(bus, mmio(0x21), 2);
    w8(bus, mmio(0x22), 0x00);
    w8(bus, mmio(0x22), 0x7c);

    // Render width 400 to include X=300
    const W = 400;
    const rgba = renderMainScreenRGBA(ppu, W, 1);
    const o = (300 * 4);
    expect(rgba[o]).toBeGreaterThan(200);
  });
});

