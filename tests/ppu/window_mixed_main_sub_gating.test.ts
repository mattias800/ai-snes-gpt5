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

describe('Mixed main/sub gating: main uses A only, subscreen uses B only', () => {
  function writeSolid(bus: SNESBus) {
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

  it('OR combine: blend only where main(A) and sub(B) both allow (since both gate applyInside)', () => {
    const bus = mkBus();
    const ppu = bus.getPPU();

    // BG1 main, BG2 sub
    w8(bus, mmio(0x00), 0x0f);
    w8(bus, mmio(0x2c), 0x01);
    w8(bus, mmio(0x2d), 0x02);
    w8(bus, mmio(0x0b), 0x22);
    w8(bus, mmio(0x08), 0x04);
    writeSolid(bus);
    // BG1 red at 0, BG2 green at 0x0200
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x00); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x00);
    w8(bus, mmio(0x16), 0x00); w8(bus, mmio(0x17), 0x02); w8(bus, mmio(0x18), 0x01); w8(bus, mmio(0x19), 0x04);
    // Palettes
    w8(bus, mmio(0x21), 2);  w8(bus, mmio(0x22), 0x00); w8(bus, mmio(0x22), 0x7c);
    w8(bus, mmio(0x21), 34); w8(bus, mmio(0x22), 0xe0); w8(bus, mmio(0x22), 0x03);

    // Windows: A [0..2], B [2..4]
    w8(bus, mmio(0x26), 0x00); w8(bus, mmio(0x27), 0x02);
    w8(bus, mmio(0x28), 0x02); w8(bus, mmio(0x29), 0x04);
    // Enable BG1 A only (bit0) and BG2 B only (bit3)
    w8(bus, mmio(0x23), 0x01 | 0x08);
    // applyInside=1, OR combine
    w8(bus, mmio(0x30), 0x01 | (0 << 6) | 0x02); // also enable subscreen gating bit1
    // Color math add-half, mask=BG1
    w8(bus, mmio(0x31), 0x60 | 0x01);

    const rgba = renderMainScreenRGBA(ppu, 6, 1);
    const px = (x: number) => [rgba[x*4], rgba[x*4+1]];
    // Expect blend only at x=2 (main A end and sub B start coincide)
    expect(px(2)[0]).toBeGreaterThan(100); expect(px(2)[1]).toBeGreaterThan(100);
    // x=1: main inside A but sub masked (outside B) -> half red
    expect(px(1)[0]).toBeGreaterThan(100); expect(px(1)[1]).toBeLessThan(10);
    // x=3: sub inside B but main outside A -> no mainAffected -> pure red
    expect(px(3)[0]).toBeGreaterThan(200); expect(px(3)[1]).toBeLessThan(10);
  });
});

