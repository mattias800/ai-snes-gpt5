import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
import { render4bppTileIndices } from '../../src/ppu/renderer';

function mkBus() {
  const rom = new Uint8Array(0x20000);
  const cart = new Cartridge({ rom, mapping: 'lorom' });
  return new SNESBus(cart);
}

const mmio = (reg: number) => (0x00 << 16) | (0x2100 + (reg & 0xff));

function w8(bus: SNESBus, addr: number, v: number) { bus.write8(addr, v); }

function writeVRAMWord(bus: SNESBus, vaddr: number, word: number) {
  // Set VMAIN to inc-after-high (bit7=1) and step +1 word
  w8(bus, mmio(0x15), 0x80);
  w8(bus, mmio(0x16), vaddr & 0xff);
  w8(bus, mmio(0x17), (vaddr >>> 8) & 0xff);
  w8(bus, mmio(0x18), word & 0xff);
  w8(bus, mmio(0x19), (word >>> 8) & 0xff);
}

describe('PPU renderer: 4bpp tile decode to palette indices', () => {
  it('decodes a checkerboard tile pattern deterministically', () => {
    const bus = mkBus();

    // Tile base at word 0x0000, tileIndex 0.
    // Construct an 8x8 checkerboard using planes:
    // For each row y, bytes:
    // low0 = 0b10101010 (0xAA) and low1 = 0
    // hi0 = 0, hi1 = 0 for simplicity (2bpp checkerboard)
    for (let y = 0; y < 8; y++) {
      // Write low planes (plane0 in low byte, plane1 in high byte) to word address base + y
      w8(bus, mmio(0x15), 0x80); // increment after HIGH (bit7=1), step +1 word
      w8(bus, mmio(0x16), (0x0000 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x0000 + y) >>> 8) & 0xff);
      // plane0 = 0xAA, plane1 = 0x00
      w8(bus, mmio(0x18), 0xaa); // low byte
      w8(bus, mmio(0x19), 0x00); // high byte

      // Write high planes (plane2 low byte, plane3 high byte) to word address base + 8 + y
      w8(bus, mmio(0x16), (0x0000 + 8 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x0000 + 8 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }

    // Create PPU instance via bus internals by casting (test-only): we don't have direct access
    // Instead, indirectly use renderer by constructing a PPU reference through a backdoor is not exposed.
    // To keep architecture clean, export a helper from PPU for tests via getter. We'll adapt now.
    // For now, copy tile via renderer by requiring a PPU instance would be accessible; adjust approach:
    // We'll reconstruct a minimal PPU reference by tapping the bus read of VRAM words through $2139/$213A logic

    // Better approach: expose a function to render using the bus and the PPU inside.
    // For this test, we cheat slightly by importing the PPU type and accessing via (bus as any).ppu
    const ppu: any = (bus as any).ppu;
    const indices = render4bppTileIndices(ppu, 0x0000, 0);

    // Expected pattern: bit pattern 0xAA for plane 0 yields 1010 1010 -> pixels [0,1,0,1,0,1,0,1]
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const expected = (x % 2 === 0) ? 1 : 0;
        expect(indices[y * 8 + x]).toBe(expected);
      }
    }
  });
});

