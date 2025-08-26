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

function writeSolidOBJTile1(bus: SNESBus) {
  // 4bpp OBJ tile index 1 at char base 0x1000: plane0 rows = 0xFF
  for (let y = 0; y < 8; y++) {
    w8(bus, mmio(0x16), (0x1000 + 16 + y) & 0xff);
    w8(bus, mmio(0x17), ((0x1000 + 16 + y) >>> 8) & 0xff);
    w8(bus, mmio(0x18), 0xff); w8(bus, mmio(0x19), 0x00);
    w8(bus, mmio(0x16), (0x1000 + 16 + 8 + y) & 0xff);
    w8(bus, mmio(0x17), ((0x1000 + 16 + 8 + y) >>> 8) & 0xff);
    w8(bus, mmio(0x18), 0x00); w8(bus, mmio(0x19), 0x00);
  }
}

describe('OBJ priority vs windowed color math', () => {
  it('At overlap, color math gates based on the chosen (higher priority) sprite', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Full brightness
    w8(bus, mmio(0x00), 0x0f);

    // OBJ on main, BG2 on subscreen
    w8(bus, mmio(0x2c), 0x10);
    w8(bus, mmio(0x2d), 0x02);

    // OBJ char base 0x1000
    w8(bus, mmio(0x01), 0x02);
    writeSolidOBJTile1(bus);

    // Two sprites at same area: index=1 red for both
    // Sprite 0: position (0,0), low priority (attr bit5=0)
    w8(bus, mmio(0x02), 0x00); // Y
    w8(bus, mmio(0x04), 0x00); // X
    w8(bus, mmio(0x04), 0x00); // tile low
    w8(bus, mmio(0x04), 0x01); // tile=1
    w8(bus, mmio(0x04), 0x00); // attr (priority=0)

    // Sprite 1: position (0,0), high priority (attr bit5=1)
    w8(bus, mmio(0x02), 0x00); // Y for next
    w8(bus, mmio(0x04), 0x00); // X
    w8(bus, mmio(0x04), 0x00); // tile low
    w8(bus, mmio(0x04), 0x01); // tile=1
    w8(bus, mmio(0x04), 0x20); // attr (priority=1)

    // BG2: green solid at map 0
    w8(bus, mmio(0x0b), 0x22); w8(bus, mmio(0x08), 0x00);
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);

    // CGRAM: OBJ index1 red, BG2 index17 green
    w8(bus, mmio(0x21), 2);  w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);

    // Color math add-half; mask selects OBJ
    w8(bus, mmio(0x31), 0x60 | 0x10);

    // Window A [0..3] applies to OBJ via WOBJSEL; applyInside=1
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x03);
    w8(bus, mmio(0x25), 0x01); // A enable for OBJ
    w8(bus, mmio(0x30), 0x01);

    const rgba = renderMainScreenRGBA(ppu, 6, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];

    // For x=5 (outside A): even if low-priority sprite would be inside A somewhere, high-priority sprite wins and is outside -> no blend (pure red)
    expect(px(5)[0]).toBeGreaterThan(200); expect(px(5)[1]).toBeLessThan(20);

    // For x=1 (inside A): high-priority sprite is inside -> blend (R and G > 100)
    expect(px(1)[0]).toBeGreaterThan(100); expect(px(1)[1]).toBeGreaterThan(100);
  });
});

