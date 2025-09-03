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

describe('PPU BG char base units (BG12NBA/BG34NBA)', () => {
  it('$210B: BG1 from low nibble, BG2 from high nibble; units 0x1000 bytes (<<11 words)', () => {
    const bus = mkBus();
    const ppu = bus.getPPU() as any;
    // Write BG12NBA = 0x4A -> BG1 low=0xA? No, low nibble is 0xA; use two cases to be explicit
    w8(bus, mmio(0x0b), 0x04); // low=4, high=0
    expect(ppu.bg1CharBaseWord).toBe(4 << 11);
    expect(ppu.bg2CharBaseWord).toBe(0 << 11);

    w8(bus, mmio(0x0b), 0x90); // high=9, low=0
    expect(ppu.bg1CharBaseWord).toBe(0 << 11);
    expect(ppu.bg2CharBaseWord).toBe(9 << 11);

    w8(bus, mmio(0x0b), 0x4a); // high=4, low=10
    expect(ppu.bg1CharBaseWord).toBe(10 << 11);
    expect(ppu.bg2CharBaseWord).toBe(4 << 11);
  });

  it('$210C: BG3 from low nibble, BG4 from high nibble; units 0x1000 bytes (<<11 words)', () => {
    const bus = mkBus();
    const ppu = bus.getPPU() as any;
    w8(bus, mmio(0x0c), 0x21); // high=2, low=1
    expect(ppu.bg3CharBaseWord).toBe(1 << 11);
    expect(ppu.bg4CharBaseWord).toBe(2 << 11);

    w8(bus, mmio(0x0c), 0x00); // both zero
    expect(ppu.bg3CharBaseWord).toBe(0);
    expect(ppu.bg4CharBaseWord).toBe(0);
  });
});
