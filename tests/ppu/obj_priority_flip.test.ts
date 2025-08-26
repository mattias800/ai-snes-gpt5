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

describe('OBJ priority and flip handling (minimal)', () => {
  function writeSolidTile(bus: SNESBus, tileIndex: number) {
    for (let y = 0; y < 8; y++) {
      // plane0
      w8(bus, mmio(0x16), (0x1000 + tileIndex * 16 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + tileIndex * 16 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff);
      w8(bus, mmio(0x19), 0x00);
      // plane1
      w8(bus, mmio(0x16), (0x1000 + tileIndex * 16 + 16 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + tileIndex * 16 + 16 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }
  }

  it('higher-priority sprite wins over lower-priority sprite', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    w8(bus, mmio(0x00), 0x0f);
    // OBJ char base 0x1000
    w8(bus, mmio(0x01), 0x02);
    // Two tiles: 1 (red), 2 (green)
    writeSolidTile(bus, 1);
    writeSolidTile(bus, 2);

    // OAM sprite 0 at (0,0) tile 1, low priority (attr bit5=0), pal group 0
    w8(bus, mmio(0x02), 0x00); // OAMADDL -> 0
    w8(bus, mmio(0x04), 0x00); // X
    w8(bus, mmio(0x04), 0x00); // tile low
    w8(bus, mmio(0x04), 0x01); // tile=1
    w8(bus, mmio(0x04), 0x00); // attr group0, pri=0

    // OAM sprite 1 at (0,0) tile 2, high priority (attr bit5=1), pal group 1
    // Set OAM address to 4
    w8(bus, mmio(0x02), 0x04);
    w8(bus, mmio(0x04), 0x00); // X
    w8(bus, mmio(0x04), 0x00); // tile low
    w8(bus, mmio(0x04), 0x02); // tile=2
    w8(bus, mmio(0x04), 0x22); // attr: bit5=1 priority, bits1-3=1 => pal group 1

    // Enable OBJ on main
    w8(bus, mmio(0x2c), 0x10);

    // Palette: index1=red, index(16+1)=green
    w8(bus, mmio(0x21), 2); // index1
    w8(bus, mmio(0x22), 0x00);
    w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); // index17
    w8(bus, mmio(0x22), 0xe0);
    w8(bus, mmio(0x22), 0x03);

    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    // Expect green from the higher priority sprite
    expect(rgba[1]).toBeGreaterThan(200);
  });

  it('horizontal flip mirrors sprite pixels', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    w8(bus, mmio(0x00), 0x0f);
    w8(bus, mmio(0x01), 0x02);

    // Create a tile with left half solid (plane0=0xF0), right half zero
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x1000 + 16 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xf0); // 11110000 -> left 4 pixels solid
      w8(bus, mmio(0x19), 0x00);
      w8(bus, mmio(0x16), (0x1000 + 16 + 8 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + 8 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }

    // Two sprites: one normal at x=0, one hflip at x=0 (higher priority to pick it)
    // Normal sprite (low pri)
    w8(bus, mmio(0x02), 0x00);
    w8(bus, mmio(0x04), 0x00); // X=0
    w8(bus, mmio(0x04), 0x00);
    w8(bus, mmio(0x04), 0x01); // tile=1
    w8(bus, mmio(0x04), 0x00); // attr no flip
    // HFlip sprite (high pri)
    w8(bus, mmio(0x02), 0x04);
    w8(bus, mmio(0x04), 0x00); // X=0
    w8(bus, mmio(0x04), 0x00);
    w8(bus, mmio(0x04), 0x01); // tile=1
    w8(bus, mmio(0x04), 0x60); // attr: bit5=1 pri, bit6=1 hflip

    // Enable OBJ
    w8(bus, mmio(0x2c), 0x10);

    // Palette index1 red
    w8(bus, mmio(0x21), 2);
    w8(bus, mmio(0x22), 0x00);
    w8(bus, mmio(0x22), 0x7c);

    // Sample pixel at x=7,y=0: for hflip of left-solid tile, rightmost pixel should be solid
    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const o = (7 * 4);
    expect(rgba[o]).toBeGreaterThan(200);
  });
});

