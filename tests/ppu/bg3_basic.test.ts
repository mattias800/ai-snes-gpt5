import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
import { renderMainScreenRGBA } from '../../src/ppu/bg';

const mmio = (reg: number) => (0x00 << 16) | (0x2100 + (reg & 0xff));
const w8 = (bus: SNESBus, addr: number, v: number) => bus.write8(addr, v);

function mkBus() {
  const rom = new Uint8Array(0x20000);
  const cart = new Cartridge({ rom, mapping: 'lorom' });
  return new SNESBus(cart);
}

describe('BG3 2bpp basic render in composer (Mode 1-style)', () => {
  it('BG3 contributes when enabled and BG1/BG2 transparent', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Full brightness
    w8(bus, mmio(0x00), 0x0f);
    // Set BG Mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    // Enable only BG3 on TM
    w8(bus, mmio(0x2c), 0x04);

    // BG3 map base at 0x0000 (default)
    w8(bus, mmio(0x09), 0x00); // BG3SC
    // BG3 char base nibble=1 -> 0x1000 words
    w8(bus, mmio(0x0c), 0x02); // BG34NBA: BG3 nibble=1 (low), BG4 nibble=0 (high)

    // Create a 2bpp tile at BG3 char base: tile 0 at 0x1000 words
    // For 2bpp tiles, each tile is 8 words, so tile 0 starts at char base
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x1000 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff); // Plane 0: all pixels have bit 0 set
      w8(bus, mmio(0x19), 0x00); // Plane 1: all zeros -> pixel value 1
    }

    // BG3 tilemap entry 0 -> tile 0, palette group 0
    w8(bus, mmio(0x16), 0x00);
    w8(bus, mmio(0x17), 0x00);
    w8(bus, mmio(0x18), 0x00);
    w8(bus, mmio(0x19), 0x00);

    // Palette: index 1 -> green so it's visible
    w8(bus, mmio(0x21), 2);
    w8(bus, mmio(0x22), 0xe0);
    w8(bus, mmio(0x22), 0x03);

    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    console.log('BG3 test debug:');
    console.log('  rgba:', rgba[0], rgba[1], rgba[2], rgba[3]);
    console.log('  bg3CharBaseWord:', ppu.bg3CharBaseWord.toString(16));
    console.log('  bg3MapBaseWord:', ppu.bg3MapBaseWord.toString(16));
    console.log('  tm:', ppu.tm, 'bgMode:', ppu.bgMode);
    
    // Check tilemap entry
    const mapEntry = ppu.inspectVRAMWord(0);
    console.log('  tilemap entry at 0:', mapEntry.toString(16));
    
    // Check tile data
    const tileBase = ppu.bg3CharBaseWord;
    console.log('  tile data at', tileBase.toString(16), ':', ppu.inspectVRAMWord(tileBase));
    
    expect(rgba[1]).toBe(255);
  });
});

