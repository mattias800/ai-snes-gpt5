import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../../src/bus/snesBus';
import { Cartridge } from '../../../src/cart/cartridge';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';

const SLHV = 0x00002137;
const OPHCT_L = 0x0000213c;
const OPHCT_H = 0x0000213d;
const OPVCT_L = 0x0000213e;
const OPVCT_H = 0x0000213f;

function mkCart(): Cartridge {
  const rom = new Uint8Array(0x20000);
  return new Cartridge({ rom, mapping: 'lorom' });
}

describe('Bus bridge: $2137/$213C-$213F via TimingPPU counters', () => {
  it('latches and reads HV counters through bus', () => {
    const bus = new SNESBus(mkCart());
    const tppu = new TimingPPU();
    tppu.reset();
    (bus as any).ppu = tppu;

    // Move to scanline 5, dot 42
    for (let sl = 0; sl < 5; sl++) tppu.stepScanline();
    for (let d = 0; d < 42; d++) tppu.stepDot();

    const h = tppu.getHCounter() & 0xffff;
    const v = tppu.getVCounter() & 0xffff;

    bus.write8(SLHV, 0x00);
    const hL = bus.read8(OPHCT_L);
    const hH = bus.read8(OPHCT_H);
    const vL = bus.read8(OPVCT_L);
    const vH = bus.read8(OPVCT_H);

    expect(hL).toBe(h & 0xff);
    expect(hH).toBe((h >>> 8) & 0xff);
    expect(vL).toBe(v & 0xff);
    expect(vH).toBe((v >>> 8) & 0xff);
  });
});

