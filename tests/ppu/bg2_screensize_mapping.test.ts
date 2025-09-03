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

describe('BG2 screen size mapping (64x32 and 32x64)', () => {
  it('applies 0x400 and 0x800 word offsets when crossing 32-tile boundaries on BG2', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Set BG2 screen size to 64x64 (size=3) to test both width/height flags, char base 0x1000
    w8(bus, mmio(0x08), 0x03); // BG2SC size=3
    w8(bus, mmio(0x0b), 0x11); // BG1 char base 0x1000, BG2 char base 0x1000

    // Prepare tile 0 (all pixels value 1) and tile 1 (all pixels 0)
    const base = 0x1000;
    function writeTileFill(tileIndex: number, byte: number) {
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

    // Fill quadrant tilemaps at 0, +0x400, +0x800, +0xC00 word offsets
    function writeMapWord(wordAddr: number, value: number) {
      w8(bus, mmio(0x16), wordAddr & 0xff);
      w8(bus, mmio(0x17), (wordAddr >>> 8) & 0xff);
      w8(bus, mmio(0x18), value & 0xff);
      w8(bus, mmio(0x19), (value >>> 8) & 0xff);
    }
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

    // Sample centers of quadrants by setting scroll
    function sampleAtTile(tileX: number, tileY: number): number {
      ppu.bg2HOfs = tileX * 8;
      ppu.bg2VOfs = tileY * 8;
      const idx = renderBG2RegionIndices(ppu, 8, 8);
      return idx[0];
    }

    console.log('BG2 screensize debug:');
    console.log('  BG2 map base:', ppu.bg2MapBaseWord.toString(16));
    console.log('  BG2 char base:', ppu.bg2CharBaseWord.toString(16));
    console.log('  BG2 width64:', ppu.bg2MapWidth64, 'height64:', ppu.bg2MapHeight64);
    console.log('  bgMode:', ppu.bgMode);
    
    const tl = sampleAtTile(16, 16);
    const tr = sampleAtTile(48, 16);
    const bl = sampleAtTile(16, 48);
    const br = sampleAtTile(48, 48);
    
    console.log('  Sample TL (16,16):', tl);
    console.log('  Sample TR (48,16):', tr);
    console.log('  Sample BL (16,48):', bl);
    console.log('  Sample BR (48,48):', br);
    
    // Check what's at the tilemap locations
    console.log('  Tilemap at 0x0:', ppu.inspectVRAMWord(0).toString(16));
    console.log('  Tilemap at 0x400:', ppu.inspectVRAMWord(0x400).toString(16));
    console.log('  Tilemap at 0x800:', ppu.inspectVRAMWord(0x800).toString(16));
    console.log('  Tilemap at 0xc00:', ppu.inspectVRAMWord(0xc00).toString(16));
    
    expect(tl).toBe(1); // TL -> ones
    expect(tr).toBe(0); // TR -> zeros (crossed +0x400)
    expect(bl).toBe(0); // BL -> zeros (crossed +0x800)
    expect(br).toBe(1); // BR -> ones (crossed +0xC00)
  });
});

