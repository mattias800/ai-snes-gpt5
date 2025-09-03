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

describe('Two-window combine modes for BG1 (simplified)', () => {
  function writeSolidTile(bus: SNESBus, pattern: number) {
    for (let y = 0; y < 8; y++) {
      w8(bus, mmio(0x16), (0x1000 + 16 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), pattern);
      w8(bus, mmio(0x19), 0x00);
      w8(bus, mmio(0x16), (0x1000 + 16 + 8 + y) & 0xff);
      w8(bus, mmio(0x17), ((0x1000 + 16 + 8 + y) >>> 8) & 0xff);
      w8(bus, mmio(0x18), 0x00);
      w8(bus, mmio(0x19), 0x00);
    }
  }

  function setupBG1BG2(bus: SNESBus) {
    // Brightness
    w8(bus, mmio(0x00), 0x0f);
    // Set BG mode 1 (BG1/2 are 4bpp, BG3 is 2bpp)
    w8(bus, mmio(0x05), 0x01);
    // Main BG1, Sub BG2
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x2d), 0x02);
    // Char bases 0x1000
    w8(bus, mmio(0x0b), 0x22);
    // BG2 map base at 0x0400 bytes to avoid overlap
    w8(bus, mmio(0x08), 0x04);
    // Tiles
    writeSolidTile(bus, 0xff);
    // BG1 tile at 0, pal0
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);
    // BG2 tile at word 0x0200, pal group 1
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x02); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);
    // Palettes: BG1 index1=red, BG2 index17=green
    w8(bus, mmio(0x21), 2); w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);
  }

  it('OR combine (CGWSEL bits6-7=00) blends in regions covered by A or B', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    setupBG1BG2(bus);
    // Window A: [0..1], Window B: [3..4]
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x01);
    w8(bus, mmio(0x28), 0x03); w8(bus, mmio(0x29), 0x04);
    // W12SEL: BG1 uses Window A and B; CGWSEL: applyInside=1, combine=OR (00)
    w8(bus, mmio(0x23), 0x03); // A and B enabled for BG1
    w8(bus, mmio(0x30), 0x01 | (0 << 6));
    // CGADSUB: enable+half, mask=BG1
    w8(bus, mmio(0x31), 0x60 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // x=0,1 in A => blend; x=3,4 in B => blend; x=2,5 not in A|B => no blend
    expect(px(0)[0]).toBeGreaterThan(100); expect(px(0)[1]).toBeGreaterThan(100);
    expect(px(2)[0]).toBeGreaterThan(200); expect(px(2)[1]).toBeLessThan(10);
    expect(px(3)[0]).toBeGreaterThan(100); expect(px(3)[1]).toBeGreaterThan(100);
  });

  it('AND combine (CGWSEL bits6-7=01) blends only where A and B overlap', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    setupBG1BG2(bus);
    // Make A and B overlap at x=2
    w8(bus, mmio(0x26), 0x01); w8(bus, mmio(0x27), 0x02); // A [1..2]
    w8(bus, mmio(0x28), 0x02); w8(bus, mmio(0x29), 0x03); // B [2..3]
    // Enable A and B for BG1 to participate in AND
    w8(bus, mmio(0x23), 0x03);
    w8(bus, mmio(0x30), 0x01 | (1 << 6)); // applyInside=1, AND
    w8(bus, mmio(0x31), 0x60 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 8, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // Only x=2 blended
    expect(px(2)[0]).toBeGreaterThan(100);
    expect(px(2)[1]).toBeGreaterThan(100);
    expect(px(1)[0]).toBeGreaterThan(200);
    expect(px(1)[1]).toBeLessThan(10);
    expect(px(3)[0]).toBeGreaterThan(200);
    expect(px(3)[1]).toBeLessThan(10);
  });

  it('XOR combine (CGWSEL bits6-7=10) blends only where A xor B', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    setupBG1BG2(bus);
    // A [0..2], B [2..4] -> XOR => x=0,1,3,4 blend; x=2 no blend
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x02);
    w8(bus, mmio(0x28), 0x02); w8(bus, mmio(0x29), 0x04);
    w8(bus, mmio(0x23), 0x03); // enable A and B for BG1
    w8(bus, mmio(0x30), 0x01 | (2 << 6)); // applyInside=1, XOR
    w8(bus, mmio(0x31), 0x60 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 6, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    expect(px(1)[0]).toBeGreaterThan(100); expect(px(1)[1]).toBeGreaterThan(100); // in A only
    expect(px(2)[0]).toBeGreaterThan(200); expect(px(2)[1]).toBeLessThan(10);     // in both -> XOR false
    expect(px(4)[0]).toBeGreaterThan(100); expect(px(4)[1]).toBeGreaterThan(100); // in B only
  });

  it('XNOR combine (CGWSEL bits6-7=11) blends where both in or both out', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    setupBG1BG2(bus);
    // A [0..2], B [2..4] -> XNOR true at x=2 (both), and outside both (x>=5)
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x02);
    w8(bus, mmio(0x28), 0x02); w8(bus, mmio(0x29), 0x04);
    w8(bus, mmio(0x23), 0x03);
    w8(bus, mmio(0x30), 0x01 | (3 << 6)); // applyInside=1, XNOR
    w8(bus, mmio(0x31), 0x60 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 7, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // x=2 (both) blended
    expect(px(2)[0]).toBeGreaterThan(100); expect(px(2)[1]).toBeGreaterThan(100);
    // x=5 (outside both) blended
    expect(px(5)[0]).toBeGreaterThan(100); expect(px(5)[1]).toBeGreaterThan(100);
    // x=1 (A only) not blended
    expect(px(1)[0]).toBeGreaterThan(200); expect(px(1)[1]).toBeLessThan(10);
  });

  it('Invert via applyInside=0: blends outside the combined window', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();
    setupBG1BG2(bus);
    // Window A: [0..2], no B, combine OR
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x02);
    w8(bus, mmio(0x23), 0x01);
    w8(bus, mmio(0x30), 0x00 | (0 << 6)); // applyInside=0, OR
    w8(bus, mmio(0x31), 0x60 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 6, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // x<=2 inside window => no blend; x>=3 outside => blend
    expect(px(1)[0]).toBeGreaterThan(200);
    expect(px(1)[1]).toBeLessThan(10);
    expect(px(4)[0]).toBeGreaterThan(100);
    expect(px(4)[1]).toBeGreaterThan(100);
  });
});

