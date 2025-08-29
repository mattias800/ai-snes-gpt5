import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../../src/bus/snesBus';
import { Cartridge } from '../../../src/cart/cartridge';
import { TimingPPU } from '../../../src/ppu/timing/ppu_timing';

const HVBJOY = 0x00004212;

function mkCart(): Cartridge {
  const rom = new Uint8Array(0x20000);
  return new Cartridge({ rom, mapping: 'lorom' });
}

describe('Bus bridge: $4212 reflects TimingPPU isVBlank/isHBlank when injected', () => {
  it('reads VBlank/HBlank bits from TimingPPU', () => {
    const bus = new SNESBus(mkCart());
    const tppu = new TimingPPU();
    tppu.reset();
    // Inject timing PPU into bus (test-only)
    (bus as any).ppu = tppu;

    // Initially at scanline 0, dot 0 -> not in VBlank and not in HBlank
    let v = bus.read8(HVBJOY);
    expect(v & 0x80).toBe(0);
    expect(v & 0x40).toBe(0);

    // Step to VBlank start (line 224)
    for (let sl = 0; sl < 224; sl++) tppu.stepScanline();
    v = bus.read8(HVBJOY);
    expect(v & 0x80).toBe(0x80);

    // Step a few dots near end of line to hit HBlank (approx behavior)
    let hblankSeen = false;
    for (let i = 0; i < 400; i++) {
      tppu.stepDot();
      const hv = bus.read8(HVBJOY);
      if (hv & 0x40) { hblankSeen = true; break; }
    }
    expect(hblankSeen).toBe(true);
  });
});

