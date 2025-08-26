import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';

const mmio = (reg: number) => (0x00 << 16) | (0x2100 + (reg & 0xff));
const w8 = (bus: SNESBus, addr: number, v: number) => bus.write8(addr, v);

function mkBus() {
  const rom = new Uint8Array(0x20000);
  const cart = new Cartridge({ rom, mapping: 'lorom' });
  return new SNESBus(cart);
}

describe('PPU BG2 base and scroll registers', () => {
  it('computes BG2 map/char base from $2108/$210B and latches BG2HOFS/BG2VOFS from two writes', () => {
    const bus = mkBus();
    const ppu = bus.getPPU() as any;

    // BG2SC ($2108): set base to 0x0C00 bytes -> words = 0x0600
    w8(bus, mmio(0x08), 0x0c);
    expect(ppu.bg2MapBaseWord).toBe(0x0600);

    // BG12NBA ($210B): low nibble selects BG2 char base; nibble 3 -> 3*0x800 words = 0x1800 words
    w8(bus, mmio(0x0b), 0x03);
    expect(ppu.bg2CharBaseWord).toBe(0x1800);

    // BG2HOFS ($210F): write low then high (only bits 0-2 used)
    w8(bus, mmio(0x0f), 0x78);
    w8(bus, mmio(0x0f), 0x02);
    expect(ppu.bg2HOfs).toBe(((0x02 & 0x07) << 8) | 0x78);

    // BG2VOFS ($2110): write low then high
    w8(bus, mmio(0x10), 0x9a);
    w8(bus, mmio(0x10), 0x03);
    expect(ppu.bg2VOfs).toBe(((0x03 & 0x07) << 8) | 0x9a);
  });
});

