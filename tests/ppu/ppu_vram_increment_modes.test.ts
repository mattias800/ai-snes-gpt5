import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';

const mmio = (reg: number) => (0x00 << 16) | (0x2100 + (reg & 0xff));
const w8 = (bus: SNESBus, addr: number, v: number) => bus.write8(addr, v);
const r8 = (bus: SNESBus, addr: number) => bus.read8(addr);

function mkBus() {
  const rom = new Uint8Array(0x20000);
  const cart = new Cartridge({ rom, mapping: 'lorom' });
  return new SNESBus(cart);
}

describe('PPU VRAM increment modes', () => {
  it('inc-after-high (bit7=1), step +32 words', () => {
    const bus = mkBus();
    // Set VMAIN: bit7=1 (inc after HIGH), step=1 -> +32 words
    w8(bus, mmio(0x15), 0x81);
    // Set VADDR to 0x0000
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x00);

    // Write two words via $2118/$2119 -> should land at 0x0000 and 0x0020
    w8(bus, mmio(0x18), 0x11);
    w8(bus, mmio(0x19), 0x22); // inc here to 0x0020
    w8(bus, mmio(0x18), 0x33);
    w8(bus, mmio(0x19), 0x44);

    const ppu = bus.getPPU();
    expect(ppu.inspectVRAMWord(0x0000)).toBe(0x2211);
    expect(ppu.inspectVRAMWord(0x0020)).toBe(0x4433);
  });

  it('inc-after-low (bit7=0), step +128 words', () => {
    const bus = mkBus();
    // Set VMAIN: bit7=0 (inc after LOW), step=2 -> +128 words
    w8(bus, mmio(0x15), 0x02);
    // Set VADDR to 0x0100
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x01);

    // With inc-after-low, to write a single 16-bit word, write HIGH first, then LOW.
    // This ensures the increment (which happens on LOW) occurs after the pair is completed.
    // First word at 0x0100 -> 0x6655
    w8(bus, mmio(0x19), 0x66); // high (no increment)
    w8(bus, mmio(0x18), 0x55); // low  -> increment to 0x0180

    // Second word at 0x0180 -> 0x8877
    w8(bus, mmio(0x19), 0x88); // high (no increment)
    w8(bus, mmio(0x18), 0x77); // low  -> increment to 0x0200

    const ppu = bus.getPPU();
    expect(ppu.inspectVRAMWord(0x0100)).toBe(0x6655);
    expect(ppu.inspectVRAMWord(0x0180)).toBe(0x8877);
  });

  it('VRAM read increments match VMAIN bit7 setting', () => {
    const bus = mkBus();
    // Seed VRAM words 0x0000=0xAAAA, 0x0001=0xBBBB
    w8(bus, mmio(0x15), 0x00);
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x00);
    w8(bus, mmio(0x18), 0xaa);
    w8(bus, mmio(0x19), 0xaa);
    w8(bus, mmio(0x18), 0xbb);
    w8(bus, mmio(0x19), 0xbb);

  // Set VADDR to 0x0000 and VMAIN bit7=1 (inc after HIGH)
  w8(bus, mmio(0x15), 0x80);
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x00);
    // Read low, high -> increment after high
    expect(r8(bus, mmio(0x39))).toBe(0xaa);
    expect(r8(bus, mmio(0x3a))).toBe(0xaa);
    // Now reading next low should be from 0x0001
    expect(r8(bus, mmio(0x39))).toBe(0xbb);

  // Set VMAIN bit7=0 (inc after LOW), reset VADDR
  w8(bus, mmio(0x15), 0x00);
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x00);
    expect(r8(bus, mmio(0x39))).toBe(0xaa); // low -> increment now
    expect(r8(bus, mmio(0x39))).toBe(0xbb); // low of next word
  });
});

