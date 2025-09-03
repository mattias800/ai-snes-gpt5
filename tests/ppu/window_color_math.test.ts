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

describe('Windowed color math (simplified)', () => {
  function writeSolidTile(bus: SNESBus) {
    // Write tiles at char base 0x1000 (tile 1 at 0x1010)
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x1000 + 16 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0xff);
      w8(bus, mmio(0x19), 0x00);
      w8(bus, mmio(0x16), (0x1000 + 16 + 8 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + 8 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }
  }

  it('applies color math only inside window when applyInside=1 and W12SEL enables BG1', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Brightness
    w8(bus, mmio(0x00), 0x0f);
    
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);

    // BG1 main, BG2 subscreen
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x2d), 0x02);

    // BG1/BG2 char bases 0x1000
    w8(bus, mmio(0x0b), 0x11);
    // Set BG2 map base separate to avoid clobbering BG1 tilemap
    w8(bus, mmio(0x08), 0x04); // BG2SC = 0x0400 bytes
    // BG1 tile solid red at (0,0)
    writeSolidTile(bus);
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);
    // BG2 tile solid green at (0,0), palette group 1 at word 0x0200
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x02); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);

    // Palettes
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c); // red at 1
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03); // green at 17

    // Window: left=0, right=3; enable BG1 window via W12SEL bit0
    w8(bus, mmio(0x26), 0x00); // WH0
    w8(bus, mmio(0x27), 0x03); // WH1
    w8(bus, mmio(0x23), 0x01); // W12SEL: BG1 affected

    // CGWSEL: applyInside=1 (bit0)
    w8(bus, mmio(0x30), 0x01);
    // CGADSUB: enable+half, mask=BG1
    w8(bus, mmio(0x31), 0x60 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1], rgba[x*4+2]];
    
    // Debug
    console.log('Window color math debug:');
    console.log('  tm:', ppu.tm.toString(2).padStart(5, '0'), 'ts:', ppu.ts.toString(2).padStart(5, '0'));
    console.log('  cgwsel:', ppu.cgwsel.toString(16), 'cgadsub:', ppu.cgadsub.toString(16));
    console.log('  w12sel:', ppu.w12sel.toString(16));
    console.log('  Window A: [', ppu.wh0, '-', ppu.wh1, ']');
    console.log('  BG1 char base:', ppu.bg1CharBaseWord.toString(16), 'map base:', ppu.bg1MapBaseWord.toString(16));
    console.log('  BG2 char base:', ppu.bg2CharBaseWord.toString(16), 'map base:', ppu.bg2MapBaseWord.toString(16));
    console.log('  Tilemap entry at 0:', ppu.inspectVRAMWord(0).toString(16));
    console.log('  Tilemap entry at 0x200:', ppu.inspectVRAMWord(0x200).toString(16));
    console.log('  Tile data at 0x1010:', ppu.inspectVRAMWord(0x1010).toString(16));
    console.log('  CGRAM at 1:', ppu.inspectCGRAMWord(1).toString(16));
    console.log('  CGRAM at 17:', ppu.inspectCGRAMWord(17).toString(16));
    for (let x = 0; x < 8; x++) {
      console.log(`  px[${x}]: R=${px(x)[0]}, G=${px(x)[1]}, B=${px(x)[2]}`);
    }

    // x=0..3 inside window: expect blended R/G > 0
    expect(px(1)[0]).toBeGreaterThan(100);
    expect(px(1)[1]).toBeGreaterThan(100);
    // x=4 outside window: expect pure red (no blend)
    expect(px(5)[0]).toBeGreaterThan(200);
    expect(px(5)[1]).toBeLessThan(10);
  });

  it('applies color math only outside window when applyInside=0', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // Brightness
    w8(bus, mmio(0x00), 0x0f);
    
    // Set BG mode 1
    w8(bus, mmio(0x05), 0x01);

    // BG1 main, BG2 subscreen
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x2d), 0x02);
    w8(bus, mmio(0x0b), 0x11);
    // Separate BG2 map base
    w8(bus, mmio(0x08), 0x04);
    writeSolidTile(bus);
    // BG1 tile
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);
    // BG2 tile pal group 1 at word 0x0200
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x02); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);

    // Palettes
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);

    // Window range and enable on BG1
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x03);
    w8(bus, mmio(0x23), 0x01);

    // CGWSEL: applyInside=0
    w8(bus, mmio(0x30), 0x00);
    // CGADSUB: enable+half, mask=BG1
    w8(bus, mmio(0x31), 0x60 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1], rgba[x*4+2]];

    // inside window (x<=3): expect pure red (no blend)
    expect(px(1)[0]).toBeGreaterThan(200);
    expect(px(1)[1]).toBeLessThan(10);
    // outside window (x>=4): expect blended R/G > 0
    expect(px(5)[0]).toBeGreaterThan(100);
    expect(px(5)[1]).toBeGreaterThan(100);
  });
});

