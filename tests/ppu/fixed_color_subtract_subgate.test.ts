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

function writeSolid4bpp(bus: SNESBus) {
  for (let y = 0; y < 8; y++) {
    w8(bus, mmio(0x16), (0x1000 + 16 + y) & 0xff);
    w8(bus, mmio(0x17), ((0x1000 + 16 + y) >>> 8) & 0xff);
    w8(bus, mmio(0x18), 0xff); w8(bus, mmio(0x19), 0x00);
    w8(bus, mmio(0x16), (0x1000 + 16 + 8 + y) & 0xff);
    w8(bus, mmio(0x17), ((0x1000 + 16 + 8 + y) >>> 8) & 0xff);
    w8(bus, mmio(0x18), 0x00); w8(bus, mmio(0x19), 0x00);
  }
}

describe('Subtract mode with fixed-color subscreen and subGate toggles', () => {
  function setupWhiteMain_GreenSub(bus: SNESBus) {
    const ppu = bus.getPPU();
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    // BG1 main, BG2 subscreen
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x2d), 0x02);

    // BG1/BG2 char/map
    w8(bus, mmio(0x07), 0x00);
    w8(bus, mmio(0x08), 0x04);
    w8(bus, mmio(0x0b), 0x11);

    writeSolid4bpp(bus);

    // BG1 tile at 0, BG2 tile at word 0x0200
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x02); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);

    // Palettes: index1 white (0x7FFF), index17 green (0x03E0)
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0xff); w8(bus, mmio(0x22), 0x7f);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);
    return ppu;
  }

  it('applyInside=1: inside uses BG2 (green) for subtract; outside uses fixed blue via subGate', () => {
    const bus = mkBus();
    const ppu = setupWhiteMain_GreenSub(bus);

    // CGWSEL: applyInside=1, subGate on, fixed-color mode ON
    w8(bus, mmio(0x30), 0x01 | 0x02 | 0x04);
    // Fixed color = blue (B=31)
    w8(bus, mmio(0x32), 0x80 | 31);

    // Windows: A [0..3] used to gate subscreen BG2 via W12SEL bit2
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x03);
    w8(bus, mmio(0x23), 0x04); // Gate BG2 A only for subscreen; do not gate BG1 on main

    // CGADSUB: subtract + half + enable; mask BG1
    w8(bus, mmio(0x31), 0xe0 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1], rgba[x*4+2]];
    // Inside (x=1): (white - green)/2 => green channel reduced, blue stays high
    expect(px(1)[1]).toBeLessThan(px(1)[2]);
    // Outside (x=5): sub masked -> fixed blue used -> (white - blue)/2 => blue reduced, green stays high
    expect(px(5)[2]).toBeLessThan(px(5)[1]);
  });

  it('applyInside=0: inside uses fixed blue; outside uses BG2', () => {
    const bus = mkBus();
    const ppu = setupWhiteMain_GreenSub(bus);

    // applyInside=0, subGate on, fixed ON
    w8(bus, mmio(0x30), 0x00 | 0x02 | 0x04);
    w8(bus, mmio(0x32), 0x80 | 31);
    // Window A [0..3]; gate BG2 via W12SEL bit2
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x03);
    w8(bus, mmio(0x23), 0x04);

    // subtract-half enable; mask BG1
    w8(bus, mmio(0x31), 0xe0 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1], rgba[x*4+2]];
    // Inside (x=1): fixed blue used -> blue reduced more than green
    expect(px(1)[2]).toBeLessThan(px(1)[1]);
    // Outside (x=5): BG2 green present -> green reduced more than blue
    expect(px(5)[1]).toBeLessThan(px(5)[2]);
  });
});

