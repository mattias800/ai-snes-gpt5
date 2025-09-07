import { describe, it, expect } from 'vitest';
import { Emulator } from '../../src/emulator/core';
import { Cartridge } from '../../src/cart/cartridge';

function makeCart(): Cartridge {
  const rom = new Uint8Array(0x20000);
  // Reset vector -> $8000
  rom[0x7ffc] = 0x00; rom[0x7ffd] = 0x80;
  return new Cartridge({ rom, mapping: 'lorom' });
}

describe('MasterClock scaffold smoke', () => {
  it('stepFrameAccurate advances a frame and wraps scanline to 0', () => {
    const emu = Emulator.fromCartridge(makeCart());
    emu.reset();
    const ppu = emu.bus.getPPU();
    const before = ppu.scanline;
    emu.stepFrameAccurate();
    // Expect we wrapped a full frame
    expect(ppu.scanline).toBe(0);
    expect(before).toBe(0);
  });
});

