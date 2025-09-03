import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
import { renderMainScreenRGBA } from '../../src/ppu/bg';

const mmio = (reg: number) => (0x00 << 16) | (0x2100 + (reg & 0xff));
const w8 = (bus: SNESBus, addr: number, v: number) => bus.write8(addr, v & 0xff);

function mkBus() {
  const rom = new Uint8Array(0x20000);
  const cart = new Cartridge({ rom, mapping: 'lorom' });
  return new SNESBus(cart);
}

function writeWord(bus: SNESBus, wordAddr: number, value: number) {
  w8(bus, mmio(0x16), wordAddr & 0xff);
  w8(bus, mmio(0x17), (wordAddr >>> 8) & 0xff);
  w8(bus, mmio(0x18), value & 0xff);
  w8(bus, mmio(0x19), (value >>> 8) & 0xff);
}

describe('Frame RGBA: BG1 16x16 tile with H-flip moves red half to the other side', () => {
  it('no flip: left half red, right half black; H-flip: left half black, right half red', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Unblank, enable BG1
    w8(bus, mmio(0x00), 0x0f);
    w8(bus, mmio(0x2c), 0x01);

    // BGMODE: set BG1 tile size 16 (bit4=1)
    w8(bus, mmio(0x05), 0x10);

    // BG1 bases and VMAIN
    w8(bus, mmio(0x07), 0x00); // map base 0x0000 32x32
    w8(bus, mmio(0x0b), 0x02); // BG1 char base nibble=2 -> 0x1000 words
    w8(bus, mmio(0x15), 0x80); // VMAIN +1 word after HIGH

    // Tile graphics: create a 16x16 composed of four 8x8 tiles (indices 0,1,16,17)
    // Each 8x8 tile has plane0 pattern 0xF0 per row => left half set, right half clear
    function writeTile4bpp(tileIndex: number, baseWord: number) {
      const tileWordBase = baseWord + tileIndex * 16;
      for (let y = 0; y < 8; y++) {
        writeWord(bus, tileWordBase + y, 0x00f0); // low1:0x00, low0:0xf0
      }
      for (let y = 0; y < 8; y++) {
        writeWord(bus, tileWordBase + 8 + y, 0x0000); // hi planes 0
      }
    }

    const charBase = 0x1000;
    writeTile4bpp(0, charBase);
    writeTile4bpp(1, charBase);
    writeTile4bpp(16, charBase);
    writeTile4bpp(17, charBase);

    // Tilemap (0,0) entry -> tileIndex base 0, no flip initially
    writeWord(bus, 0x0000, 0x0000);

    // CGRAM palette index 1 = red max
    w8(bus, mmio(0x21), 0x02);
    w8(bus, mmio(0x22), 0x00);
    w8(bus, mmio(0x22), 0x7c);

    // Render 16x16 region
    const W = 16, H = 16;
    let rgba = renderMainScreenRGBA(ppu, W, H);

    // Left half inside tile should be red, right half should be black (backdrop)
    const left = (0 * W + 2) * 4;
    expect(rgba[left + 0]).toBeGreaterThan(200);
    expect(rgba[left + 1]).toBeLessThan(50);
    expect(rgba[left + 2]).toBeLessThan(50);
    const right = (0 * W + 12) * 4;
    expect(rgba[right + 0]).toBeLessThan(20);
    expect(rgba[right + 1]).toBeLessThan(20);
    expect(rgba[right + 2]).toBeLessThan(20);

    // Now set H-flip on tilemap entry (bit14)
    writeWord(bus, 0x0000, 0x4000 | 0x0000);

    rgba = renderMainScreenRGBA(ppu, W, H);

    // After H-flip, left should be black and right should be red
    const left2 = (0 * W + 2) * 4;
    expect(rgba[left2 + 0]).toBeLessThan(20);
    expect(rgba[left2 + 1]).toBeLessThan(20);
    expect(rgba[left2 + 2]).toBeLessThan(20);
    const right2 = (0 * W + 12) * 4;
    expect(rgba[right2 + 0]).toBeGreaterThan(200);
    expect(rgba[right2 + 1]).toBeLessThan(50);
    expect(rgba[right2 + 2]).toBeLessThan(50);
  });
});
