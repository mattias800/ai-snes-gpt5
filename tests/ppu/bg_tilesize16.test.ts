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

describe('BG 16x16 tile size mapping (BGMODE bit4)', () => {
  it('selects correct 8x8 subtile based on (x,y) and flip flags', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Set BG1 map base 0x0000, char base 0x1000, enable 16x16 tiles (bit4)
    w8(bus, mmio(0x07), 0x00);
    w8(bus, mmio(0x0b), 0x01);
    w8(bus, mmio(0x05), 0x10); // BGMODE: mode 0 + BG1 tiles 16x16

    // Create 4 distinct 8x8 tiles at char base 0x1000 words:
    // tileIndex base = 0, so subtiles are indices 0,1,16,17
    // Encode via plane0 patterns for uniqueness: 0xF0, 0xCC, 0xAA, 0x55
    const base = 0x1000;
    function writeTileWord(wordAddr: number, lo: number, hi: number) {
      w8(bus, mmio(0x16), wordAddr & 0xff);
      w8(bus, mmio(0x17), (wordAddr >>> 8) & 0xff);
      w8(bus, mmio(0x18), lo & 0xff);
      w8(bus, mmio(0x19), hi & 0xff);
    }
    // Tile 0 planes
    for (let y = 0; y < 8; y++) {
      writeTileWord(base + y, 0xf0, 0x00);
      writeTileWord(base + 8 + y, 0x00, 0x00);
    }
    // Tile 1 planes (immediately following in bytes -> +16 words)
    for (let y = 0; y < 8; y++) {
      writeTileWord(base + 16 + y, 0xcc, 0x00);
      writeTileWord(base + 16 + 8 + y, 0x00, 0x00);
    }
    // Tile 16 planes (tile row below -> +16*16 = +256 words)
    for (let y = 0; y < 8; y++) {
      writeTileWord(base + 256 + y, 0xaa, 0x00);
      writeTileWord(base + 256 + 8 + y, 0x00, 0x00);
    }
    // Tile 17 planes (base + 256 + 16)
    for (let y = 0; y < 8; y++) {
      writeTileWord(base + 256 + 16 + y, 0x55, 0x00);
      writeTileWord(base + 256 + 16 + 8 + y, 0x00, 0x00);
    }

    // Tilemap entry at 0 selects tileIndex 0 (which becomes 4-subtile 16x16)
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x00);
    w8(bus, mmio(0x18), 0x00);
    w8(bus, mmio(0x19), 0x00);

    // Render 16x16 region, no flip.
    const idx = renderBG1RegionIndices(ppu, 16, 16);

    // Validate quadrant representative pixels map to unique patterns
    // Choose pixel (0,0): top-left -> should come from subtile 0 (pattern 0xF0 -> left half 1s)
    expect(idx[0]).toBe(1);
    // Pixel (8,0): top-right -> subtile 1 (pattern 0xCC -> bits 11001100; at x=8->inSubX=0->bit7=1)
    expect(idx[8]).toBe(1);
    // Pixel (0,8): bottom-left -> subtile 16 (pattern 0xAA -> 10101010; x=0->bit7=1)
    expect(idx[8 * 16 + 0]).toBe(1);
    // Pixel (8,8): bottom-right -> subtile 17 (pattern 0x55 -> 01010101; x=8->inSubX=0->bit7=0)
    expect(idx[8 * 16 + 8]).toBe(0);

    // Now set X and Y flip in tilemap entry and spot-check a flipped pixel
    // Write entry with X/Y flip bits set (0xC000)
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x00);
    w8(bus, mmio(0x18), 0x00);
    w8(bus, mmio(0x19), 0xc0);

    const idxFlip = renderBG1RegionIndices(ppu, 16, 16);
    // With flips, pixel (0,0) maps to bottom-right subtile 17 at its bottom-right pixel -> for 0x55, bit index becomes 0 -> value 1
    expect(idxFlip[0]).toBe(1);
  });
});

