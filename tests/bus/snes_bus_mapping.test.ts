import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';

function mkCart(bytes: number, mapping: 'lorom' | 'hirom' = 'lorom') {
  const rom = new Uint8Array(bytes);
  // Fill ROM with bank+offset pattern to make mapping testable
  for (let i = 0; i < rom.length; i++) rom[i] = i & 0xff;
  return new Cartridge({ rom, mapping });
}

describe('SNESBus basic mapping (WRAM + ROM)', () => {
  it('reads and writes WRAM at 7E/7F banks', () => {
    const bus = new SNESBus(mkCart(0x20000));
    const addr7e = (0x7e << 16) | 0x1234;
    const addr7f = (0x7f << 16) | 0xabcd;
    bus.write8(addr7e, 0x11);
    bus.write8(addr7f, 0x22);
    expect(bus.read8(addr7e)).toBe(0x11);
    expect(bus.read8(addr7f)).toBe(0x22);
  });

  it('LoROM maps banks to 32KiB windows at $8000-$FFFF', () => {
    const cart = mkCart(0x20000, 'lorom'); // 128KiB
    const bus = new SNESBus(cart);
    // bank 0x00, addr >= 0x8000 maps to rom[0..0x7FFF]
    expect(bus.read8((0x00 << 16) | 0x8000)).toBe(0x00);
    expect(bus.read8((0x00 << 16) | 0x8001)).toBe(0x01);
    // bank 0x01 maps to next 32KiB
    expect(bus.read8((0x01 << 16) | 0x8000)).toBe(0x00);
    expect(bus.read8((0x01 << 16) | 0x8001)).toBe(0x01);
    // bank 0x02 wraps if ROM smaller
    expect(bus.read8((0x02 << 16) | 0x8000)).toBe(0x00);
  });

  it('HiROM maps 64KiB windows across banks', () => {
    const cart = mkCart(0x20000, 'hirom'); // 128KiB
    const bus = new SNESBus(cart);
    // bank 0x40, 0x0000 should read ROM[0]
    expect(bus.read8((0x40 << 16) | 0x0000)).toBe(0x00);
    // bank 0x41, 0x0001 should read ROM[0x10000 + 1] (wrapped by 0x20000)
    expect(bus.read8((0x41 << 16) | 0x0001)).toBe(0x01);
  });
});

