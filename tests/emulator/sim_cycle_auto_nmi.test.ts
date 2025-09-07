import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Cartridge } from '../../src/cart/cartridge';
import { Emulator } from '../../src/emulator/core';

function makeCartWithVectors(): Cartridge {
  const rom = new Uint8Array(0x20000);
  // Reset vector -> $8000
  rom[0x7ffc] = 0x00; rom[0x7ffd] = 0x80;
  // NMI (E-mode) vector at $FFFA/$FFFB -> $4000
  rom[0x7ffa] = 0x00; rom[0x7ffb] = 0x40;
  return new Cartridge({ rom, mapping: 'lorom' });
}

const NMITIMEN = 0x00004200;

describe('Synthetic timing (cycles): auto-deliver NMI at VBlank start', () => {
  const oldEnv: Record<string, any> = {};
  beforeEach(() => {
    // Preserve env we touch
    oldEnv.SNES_TIMING_SIM = process.env.SNES_TIMING_SIM;
    oldEnv.SNES_TIMING_MODE = process.env.SNES_TIMING_MODE;
    oldEnv.SNES_TIMING_AUTO_NMI = process.env.SNES_TIMING_AUTO_NMI;
    // Enable cycle-based synthetic timing and auto-NMI
    process.env.SNES_TIMING_SIM = '1';
    process.env.SNES_TIMING_MODE = 'cycles';
    process.env.SNES_TIMING_AUTO_NMI = '1';
  });
  afterEach(() => {
    process.env.SNES_TIMING_SIM = oldEnv.SNES_TIMING_SIM;
    process.env.SNES_TIMING_MODE = oldEnv.SNES_TIMING_MODE;
    process.env.SNES_TIMING_AUTO_NMI = oldEnv.SNES_TIMING_AUTO_NMI;
  });

  it('delivers one NMI to CPU when crossing scanline 223->224', () => {
    const cart = makeCartWithVectors();
    const emu = Emulator.fromCartridge(cart);
    emu.reset();
    // Enable NMI
    emu.bus.write8(NMITIMEN, 0x80);
    // Sanity: PC at reset vector before any NMI
    expect(emu.cpu.state.PC & 0xffff).toBe(0x8000);
    // Advance cycles to VBlank start once. Default is 1364 cycles/scanline.
    const CYCLES_PER_SCANLINE = 1364;
    emu.bus.tickCycles(224 * CYCLES_PER_SCANLINE);
    // CPU should have taken NMI to $4000
    expect(emu.cpu.state.PC & 0xffff).toBe(0x4000);
  });
});

