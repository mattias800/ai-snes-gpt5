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

function scale5To8(v: number) { return Math.floor((v * 255) / 31); }

function writeSolid4bppTile1(bus: SNESBus, charBase: number) {
  // Create 4bpp tile index 1 at specified char base: plane0 rows = 0xFF
  // 4bpp tile is 32 bytes (16 words), tile 1 starts at +16 words
  for (let y = 0; y < 8; y++) {
    // Planes 0/1 for row y (interleaved pairs)
    w8(bus, mmio(0x16), ((charBase + 16 + y*2) & 0xff));
    w8(bus, mmio(0x17), (((charBase + 16 + y*2) >>> 8) & 0xff));
    w8(bus, mmio(0x18), 0xff); // plane0 = 0xFF
    w8(bus, mmio(0x19), 0x00); // plane1 = 0x00
  }
  // Planes 2/3 for all rows
  for (let y = 0; y < 8; y++) {
    w8(bus, mmio(0x16), ((charBase + 16 + 8 + y*2) & 0xff));
    w8(bus, mmio(0x17), (((charBase + 16 + 8 + y*2) >>> 8) & 0xff));
    w8(bus, mmio(0x18), 0x00); // plane2 = 0x00
    w8(bus, mmio(0x19), 0x00); // plane3 = 0x00
  }
}

describe('Color math half rounding exactness (add/sub)', () => {
  it('add-half exact channel rounding using fixed color multi-channel', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    // Full brightness
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    // BG1 main
    w8(bus, mmio(0x2c), 0x01);
    // char/map
    w8(bus, mmio(0x07), 0x00);
    // BG12NBA: Set BG1 char base to 0x1000 (nibble 2 with new shift)
    w8(bus, mmio(0x0b), 0x02);
    writeSolid4bppTile1(bus, 0x1000);
    // tilemap entry -> tile 1 pal0
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);
    // Main color: set CGRAM index1 to R=7,G=15,B=23 (BGR555: B=23,G=15,R=7)
    const R=7,G=15,B=23; const bgr15 = (R<<10)|(G<<5)|(B);
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), bgr15 & 0xff); w8(bus, mmio(0x22), (bgr15>>8)&0xff);

    // Use fixed color as subscreen: CGWSEL bit2
    w8(bus, mmio(0x30), 0x04 | 0x01); // applyInside=1
    // Fixed color: Rf=9,Gf=3,Bf=1
    w8(bus, mmio(0x32), 0x20 | 9);
    w8(bus, mmio(0x32), 0x40 | 3);
    w8(bus, mmio(0x32), 0x80 | 1);
    // CGADSUB: enable + half, mask=BG1
    w8(bus, mmio(0x31), 0x60 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    const expR = scale5To8((R+9)>>1);
    const expG = scale5To8((G+3)>>1);
    const expB = scale5To8((B+1)>>1);
    expect(rgba[0]).toBe(expR);
    expect(rgba[1]).toBe(expG);
    expect(rgba[2]).toBe(expB);
  });

  it('subtract-half exact channel rounding (clamp to 0 before half)', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    // Full brightness
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    // BG1 main
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x07), 0x00); 
    // BG12NBA: Set BG1 char base to 0x1000 (nibble 2)
    w8(bus, mmio(0x0b), 0x02);
    writeSolid4bppTile1(bus, 0x1000);
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);
    // Main color: R=5,G=2,B=1
    const R=5,G=2,B=1; const bgr15 = (R<<10)|(G<<5)|(B);
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), bgr15 & 0xff); w8(bus, mmio(0x22), (bgr15>>8)&0xff);

    // Fixed color as subscreen: Rf=9,Gf=3,Bf=4
    w8(bus, mmio(0x30), 0x04 | 0x01);
    w8(bus, mmio(0x32), 0x20 | 9);
    w8(bus, mmio(0x32), 0x40 | 3);
    w8(bus, mmio(0x32), 0x80 | 4);
    // CGADSUB: subtract + half + enable; mask=BG1
    w8(bus, mmio(0x31), 0x80 | 0x40 | 0x20 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 1, 1);
    const expR = scale5To8((Math.max(0,R-9))>>1);
    const expG = scale5To8((Math.max(0,G-3))>>1);
    const expB = scale5To8((Math.max(0,B-4))>>1);
    expect(rgba[0]).toBe(expR);
    expect(rgba[1]).toBe(expG);
    expect(rgba[2]).toBe(expB);
  });
});

