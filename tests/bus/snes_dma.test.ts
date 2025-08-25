import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';

function mkCart(bytes: number, mapping: 'lorom' | 'hirom' = 'lorom') {
  const rom = new Uint8Array(bytes);
  for (let i = 0; i < rom.length; i++) rom[i] = i & 0xff;
  return new Cartridge({ rom, mapping });
}

function write8(bus: SNESBus, bank: number, addr: number, value: number) {
  bus.write8(((bank & 0xff) << 16) | (addr & 0xffff), value & 0xff);
}

function read8(bus: SNESBus, bank: number, addr: number) {
  return bus.read8(((bank & 0xff) << 16) | (addr & 0xffff));
}

describe('DMA MDMAEN basic transfers', () => {
  it('A->B: copy WRAM to single PPU reg (mode 0, fixed B address)', () => {
    const bus = new SNESBus(mkCart(0x20000));
    // Seed WRAM bytes at 7E:1000..1007
    for (let i = 0; i < 8; i++) write8(bus, 0x7e, 0x1000 + i, 0xa0 + i);

    // Channel 0 @ $4300, dir=0 (A->B), mode=0
    write8(bus, 0x00, 0x4300, 0x00);
    // BBAD: target B register $2122
    write8(bus, 0x00, 0x4301, 0x22);
    // A1T = $1000
    write8(bus, 0x00, 0x4302, 0x00);
    write8(bus, 0x00, 0x4303, 0x10);
    // A1B = 0x7E
    write8(bus, 0x00, 0x4304, 0x7e);
    // DAS = 8 bytes
    write8(bus, 0x00, 0x4305, 0x08);
    write8(bus, 0x00, 0x4306, 0x00);

    // Trigger MDMAEN for channel 0
    write8(bus, 0x00, 0x420b, 0x01);

    // Expect only $2122 to contain the last transferred value (0xA7); others unchanged
    expect(read8(bus, 0x00, 0x2122)).toBe(0xa7);
    expect(read8(bus, 0x00, 0x2123)).toBe(0x00);
  });

  it('B->A: copy PPU regs to WRAM (mode 1 alternates bbad/bbad+1)', () => {
    const bus = new SNESBus(mkCart(0x20000));
    // Seed PPU $2118/$2119 with known values
    write8(bus, 0x00, 0x2118, 0xaa);
    write8(bus, 0x00, 0x2119, 0xbb);

    // Setup channel 1 @ $4310, dir=1 (B->A), mode=1
    write8(bus, 0x00, 0x4310, 0x81); // DMAP: dir=1, mode=1
    write8(bus, 0x00, 0x4311, 0x18); // BBAD=$18 (i.e., $2118)
    write8(bus, 0x00, 0x4312, 0x00); // A1T=$1100
    write8(bus, 0x00, 0x4313, 0x11);
    write8(bus, 0x00, 0x4314, 0x7e); // A1B=7E
    write8(bus, 0x00, 0x4315, 0x08); // DAS=8
    write8(bus, 0x00, 0x4316, 0x00);

    // Trigger for channel 1
    write8(bus, 0x00, 0x420b, 0x02);

    // Verify WRAM 7E:1100..1107 receives the alternating bytes from $2118/$2119
    for (let i = 0; i < 8; i++) {
      expect(read8(bus, 0x7e, 0x1100 + i)).toBe(i % 2 === 0 ? 0xaa : 0xbb);
    }
  });
});

