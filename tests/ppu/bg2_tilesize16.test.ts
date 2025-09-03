import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
import { renderBG2RegionIndices } from '../../src/ppu/bg';

const mmio = (reg: number) => (0x00 << 16) | (0x2100 + (reg & 0xff));
const w8 = (bus: SNESBus, addr: number, v: number) => bus.write8(addr, v);

function mkBus() {
  const rom = new Uint8Array(0x20000);
  const cart = new Cartridge({ rom, mapping: 'lorom' });
  return new SNESBus(cart);
}

describe('BG2 16x16 tile size mapping (BGMODE bit5)', () => {
  it('selects correct 8x8 subtile based on (x,y) and flip flags for BG2', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // BG2 map base 0x0000, char base 0x1000, enable 16x16 tiles via BGMODE bit5
    w8(bus, mmio(0x08), 0x00);
    w8(bus, mmio(0x0b), 0x10); // BG2 char base nibble=1 (HIGH nibble) -> 0x1000 words
    w8(bus, mmio(0x05), 0x20); // mode 0, bit5=1 -> BG2 16x16

    // Create 4 distinct 8x8 tiles at char base 0x1000 words:
    // tileIndex base = 0, so subtiles are indices 0,1,16,17
    const base = 0x1000;
    function writeTileWord(wordAddr: number, lo: number, hi: number) {
      w8(bus, mmio(0x16), wordAddr & 0xff);
      w8(bus, mmio(0x17), (wordAddr >>> 8) & 0xff);
      w8(bus, mmio(0x18), lo & 0xff);
      w8(bus, mmio(0x19), hi & 0xff);
    }
    // Tile 0 planes (pattern 0xF0)
    for (let y = 0; y < 8; y++) {
      writeTileWord(base + y, 0xf0, 0x00);
      writeTileWord(base + 8 + y, 0x00, 0x00);
    }
    // Tile 1 planes (pattern 0xCC)
    for (let y = 0; y < 8; y++) {
      writeTileWord(base + 16 + y, 0xcc, 0x00);
      writeTileWord(base + 16 + 8 + y, 0x00, 0x00);
    }
    // Tile 16 planes (pattern 0xAA)
    for (let y = 0; y < 8; y++) {
      writeTileWord(base + 256 + y, 0xaa, 0x00);
      writeTileWord(base + 256 + 8 + y, 0x00, 0x00);
    }
    // Tile 17 planes (pattern 0x55)
    for (let y = 0; y < 8; y++) {
      writeTileWord(base + 256 + 16 + y, 0x55, 0x00);
      writeTileWord(base + 256 + 16 + 8 + y, 0x00, 0x00);
    }

    // BG2 tilemap entry at 0 selects tileIndex 0
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x00);
    w8(bus, mmio(0x18), 0x00);
    w8(bus, mmio(0x19), 0x00);

    // Render 16x16 region, no flip
    const idx = renderBG2RegionIndices(ppu, 16, 16);

    // Validate quadrants
    expect(idx[0]).toBe(1);                   // top-left -> tile 0 pattern 0xF0 => leftmost bit set
    expect(idx[8]).toBe(1);                   // top-right -> tile 1 pattern 0xCC => bit7 set
    expect(idx[8 * 16 + 0]).toBe(1);          // bottom-left -> tile 16 pattern 0xAA => bit7 set
    expect(idx[8 * 16 + 8]).toBe(0);          // bottom-right -> tile 17 pattern 0x55 => bit7 clear

    // Now set X/Y flip on tilemap entry (0xC000)
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x00);
    w8(bus, mmio(0x18), 0x00);
    w8(bus, mmio(0x19), 0xc0);

    const idxFlip = renderBG2RegionIndices(ppu, 16, 16);
    expect(idxFlip[0]).toBe(1);               // after flip, (0,0) samples bottom-right subtile's LSB -> 1 for 0x55 pattern
  });
});

