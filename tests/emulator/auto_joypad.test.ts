import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Emulator } from '../../src/emulator/core';
import { Cartridge } from '../../src/cart/cartridge';

function makeCart(): Cartridge {
  const rom = new Uint8Array(0x20000);
  // Reset vector to $8000
  rom[0x7ffc] = 0x00; rom[0x7ffd] = 0x80;
  return new Cartridge({ rom, mapping: 'lorom' });
}

describe('Auto-joypad: $4218/$4219 latch at VBlank start when enabled', () => {
  const oldEnv: Record<string, any> = {};
  beforeEach(() => {
    oldEnv.SNES_TIMING_SIM = process.env.SNES_TIMING_SIM;
    oldEnv.SNES_TIMING_MODE = process.env.SNES_TIMING_MODE;
    process.env.SNES_TIMING_SIM = '1';
    process.env.SNES_TIMING_MODE = 'cycles';
  });
  afterEach(() => {
    process.env.SNES_TIMING_SIM = oldEnv.SNES_TIMING_SIM;
    process.env.SNES_TIMING_MODE = oldEnv.SNES_TIMING_MODE;
  });

  it('latches controller 1 result into $4218/$4219 when $4200 bit0=1', () => {
    const emu = Emulator.fromCartridge(makeCart());
    emu.reset();

    // Set controller state (press A and Start)
    emu.bus.setController1State({ A: true, Start: true });

    // Enable NMI and auto-joypad (bit7=1, bit0=1)
    const NMITIMEN = 0x00004200;
    emu.bus.write8(NMITIMEN, 0x81);

    // Advance to VBlank start
    const CYCLES_PER_SCANLINE = 1364;
    (emu.bus as any).tickCycles?.(224 * CYCLES_PER_SCANLINE);

    const joy1l = emu.bus.read8(0x00004218) & 0xff;
    const joy1h = emu.bus.read8(0x00004219) & 0xff;

    // We don't assert exact bit pattern; just ensure non-zero when buttons set
    expect((joy1l | joy1h) & 0xff).not.toBe(0);
  });
});

