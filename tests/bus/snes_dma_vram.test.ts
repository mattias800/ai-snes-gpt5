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

describe('DMA to VRAM and CGRAM via PPU ports', () => {
  it('A->B mode 1 DMA writes sequential VRAM words via $2118/$2119 with inc-after-high', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    // Set VMAIN inc after high, step +1 word
    w8(bus, mmio(0x15), 0x00);
    // Set VADDR word base
    const base = 0x0200;
    w8(bus, mmio(0x16), base & 0xff);
    w8(bus, mmio(0x17), (base >>> 8) & 0xff);

    // Prepare 16 bytes in WRAM 7E:1100..110F: pairs (lo, hi) -> words
    const start = 0x1100;
    for (let i = 0; i < 16; i++) bus.write8((0x7e << 16) | (start + i), 0x80 + i);

    // Channel 0: DMAP=mode1 (0x01), dir=0 A->B; BBAD=$18; A1T=$1100; A1B=7E; DAS=16
    w8(bus, 0x004300, 0x01);
    w8(bus, 0x004301, 0x18);
    w8(bus, 0x004302, start & 0xff);
    w8(bus, 0x004303, (start >>> 8) & 0xff);
    w8(bus, 0x004304, 0x7e);
    w8(bus, 0x004305, 16);
    w8(bus, 0x004306, 0x00);

    // Trigger MDMAEN for channel 0
    w8(bus, 0x00420b, 0x01);

    // Verify 8 words written
    for (let i = 0; i < 8; i++) {
      const lo = 0x80 + (i * 2 + 0);
      const hi = 0x80 + (i * 2 + 1);
      const word = (hi << 8) | lo;
      expect(ppu.inspectVRAMWord(base + i)).toBe(word);
    }
  });

  it('A->B mode 0 DMA writes sequential CGRAM bytes via $2122', () => {
    const bus = mkBus();
    // Set CGADD to 0x30
    w8(bus, mmio(0x21), 0x30);

    // Prepare 4 bytes in WRAM 7E:1200..1203
    const start = 0x1200;
    const data = [0xde, 0xad, 0xbe, 0xef];
    data.forEach((v, i) => bus.write8((0x7e << 16) | (start + i), v));

    // Channel 1: DMAP=mode0 (0x00), dir=0 A->B; BBAD=$22; A1T=$1200; A1B=7E; DAS=4
    w8(bus, 0x004310, 0x00);
    w8(bus, 0x004311, 0x22);
    w8(bus, 0x004312, start & 0xff);
    w8(bus, 0x004313, (start >>> 8) & 0xff);
    w8(bus, 0x004314, 0x7e);
    w8(bus, 0x004315, data.length);
    w8(bus, 0x004316, 0x00);

    // Trigger MDMAEN for channel 1
    w8(bus, 0x00420b, 0x02);

    // Read back via $213B (auto-increment)
    w8(bus, mmio(0x21), 0x30);
    for (let i = 0; i < data.length; i++) {
      expect(r8(bus, mmio(0x3b))).toBe(data[i]);
    }
  });
});

