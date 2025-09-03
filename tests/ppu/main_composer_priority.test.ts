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

describe('Main composer with per-tile priority (BG2 high over BG1 low)', () => {
  it('shows BG2 pixel when BG2 has high priority and BG1 has low priority', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Full brightness, enable BG1 and BG2
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    w8(bus, mmio(0x2c), 0x03);

    // BG1: map base 0, char base 0x1000; tile 1 solid, low priority (bit13=0)
    w8(bus, mmio(0x07), 0x00);
    w8(bus, mmio(0x0b), 0x02);
    // tile data at 0x1000 + 16 words
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x1000 + 16 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff); // plane0
      w8(bus, mmio(0x19), 0x00);
      w8(bus, mmio(0x16), (0x1000 + 16 + 8 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + 8 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }
    // BG1 tilemap entry 0 -> tile 1, low priority (bit13=0)
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x00);
    w8(bus, mmio(0x18), 0x01);
    w8(bus, mmio(0x19), 0x00);

    // BG2: map base 0, char base same (0x1000), tile 1 solid, HIGH priority (bit13=1)
    // BG2SC already 0; set HOFS/VOFS default implicitly
    // BG2 tilemap entry 0 -> tile 1 with bit13 set
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x00);
    w8(bus, mmio(0x18), 0x01);
    w8(bus, mmio(0x19), 0x20); // set bit13

    // Palette: index 1 = green (0x03E0) so it differs from red
    w8(bus, mmio(0x21), 2);
    w8(bus, mmio(0x22), 0xe0);
    w8(bus, mmio(0x22), 0x03);

    // Render 1x1 and check green (BG2 wins)
    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    expect(rgba[1]).toBe(255); // green channel
  });
});

