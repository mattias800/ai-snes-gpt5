import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
import { renderBG1RegionIndices } from '../../src/ppu/bg';

const mmio = (reg: number) => (0x00 << 16) | (0x2100 + (reg & 0xff));
const w8 = (bus: SNESBus, addr: number, v: number) => bus.write8(addr, v);

function mkBus() {
  const rom = new Uint8Array(0x20000);
  const cart = new Cartridge({ rom, mapping: 'lorom' });
  return new SNESBus(cart);
}

describe('BG screen size mapping (64x32 and 32x64)', () => {
  it('applies 0x400 and 0x800 word offsets when crossing 32-tile boundaries', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Set BG1 map base 0x0000, char base 0x1000, 8x8 tiles
    w8(bus, mmio(0x07), 0x03); // size=3 -> 64x64 (both width and height flags true)
    w8(bus, mmio(0x0b), 0x02); // char base 0x1000 words (BG1 low nibble)

    // Prepare tile 0 (all pixels value 1) and tile 1 (all pixels 0)
    const base = 0x1000;
    function writeTileFill(tileIndex: number, byte: number) {
      // plane0=byte, others 0
      const wordBase = base + tileIndex * 16;
      for (let y = 0; y < 8; y++) {
        w8(bus, mmio(0x16), (wordBase + y) & 0xff);
        w8(bus, mmio(0x17), ((wordBase + y) >>> 8) & 0xff);
        w8(bus, mmio(0x18), byte);
        w8(bus, mmio(0x19), 0x00);
        w8(bus, mmio(0x16), (wordBase + 8 + y) & 0xff);
        w8(bus, mmio(0x17), ((wordBase + 8 + y) >>> 8) & 0xff);
        w8(bus, mmio(0x18), 0x00);
        w8(bus, mmio(0x19), 0x00);
      }
    }
    writeTileFill(0, 0xff); // all ones
    writeTileFill(1, 0x00); // all zeros

    // Build tilemap such that:
    // - top-left 32x32 quadrant filled with tile 0 (value 1)
    // - top-right quadrant (offset +0x400 words) filled with tile 1 (value 0)
    // - bottom-left quadrant (offset +0x800 words) filled with tile 1 (value 0)
    // - bottom-right quadrant (offset +0xC00 words) filled with tile 0 (value 1)
    function writeMapWord(wordAddr: number, value: number) {
      w8(bus, mmio(0x16), wordAddr & 0xff);
      w8(bus, mmio(0x17), (wordAddr >>> 8) & 0xff);
      w8(bus, mmio(0x18), value & 0xff);
      w8(bus, mmio(0x19), (value >>> 8) & 0xff);
    }
    // Fill 32x32 block helper
    function fillBlock(baseWord: number, tileIndex: number) {
      for (let ty = 0; ty < 32; ty++) {
        for (let tx = 0; tx < 32; tx++) {
          writeMapWord(baseWord + ty * 32 + tx, tileIndex);
        }
      }
    }
    fillBlock(0x0000, 0);      // top-left -> ones
    fillBlock(0x0400, 1);      // top-right -> zeros
    fillBlock(0x0800, 1);      // bottom-left -> zeros
    fillBlock(0x0c00, 0);      // bottom-right -> ones

    // Sample four 8x8 regions centered in each quadrant by adjusting scroll
    // Quadrant centers in tiles: (16,16), (48,16), (16,48), (48,48)
    function sampleAtTile(tileX: number, tileY: number): number {
      // Set scroll so render origin maps to the given tile
      ppu.bg1HOfs = tileX * 8;
      ppu.bg1VOfs = tileY * 8;
      const idx = renderBG1RegionIndices(ppu, 8, 8);
      return idx[0];
    }

    expect(sampleAtTile(16, 16)).toBe(1); // top-left -> ones
    expect(sampleAtTile(48, 16)).toBe(0); // top-right -> zeros (crossed +0x400)
    expect(sampleAtTile(16, 48)).toBe(0); // bottom-left -> zeros (crossed +0x800)
    expect(sampleAtTile(48, 48)).toBe(1); // bottom-right -> ones (crossed +0xC00)
  });
});

