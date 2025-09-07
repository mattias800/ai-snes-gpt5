import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Cartridge } from '../../src/cart/cartridge';
import { Emulator } from '../../src/emulator/core';

function makeCart(): Cartridge {
  const rom = new Uint8Array(0x20000);
  // Reset to $8000
  rom[0x7ffc] = 0x00; rom[0x7ffd] = 0x80;
  return new Cartridge({ rom, mapping: 'lorom' });
}

describe('Synthetic timing: HBlank callbacks and APU stepping', () => {
  const oldEnv: Record<string, any> = {};
  beforeEach(() => {
    oldEnv.SNES_TIMING_SIM = process.env.SNES_TIMING_SIM;
    oldEnv.SNES_TIMING_MODE = process.env.SNES_TIMING_MODE;
    oldEnv.SNES_TIMING_IPS = process.env.SNES_TIMING_IPS;
    oldEnv.SNES_TIMING_HBLANK_FRAC = process.env.SNES_TIMING_HBLANK_FRAC;
  });
  afterEach(() => {
    process.env.SNES_TIMING_SIM = oldEnv.SNES_TIMING_SIM;
    process.env.SNES_TIMING_MODE = oldEnv.SNES_TIMING_MODE;
    process.env.SNES_TIMING_IPS = oldEnv.SNES_TIMING_IPS;
    process.env.SNES_TIMING_HBLANK_FRAC = oldEnv.SNES_TIMING_HBLANK_FRAC;
  });

  it('invokes HBlank callback enter/exit in instruction-count mode', () => {
    process.env.SNES_TIMING_SIM = '1';
    delete process.env.SNES_TIMING_MODE; // instr mode
    process.env.SNES_TIMING_IPS = '100';
    process.env.SNES_TIMING_HBLANK_FRAC = '10'; // hblank = 1/10 of scanline

    const emu = Emulator.fromCartridge(makeCart());
    emu.reset();

    const hbEvents: Array<{hb:boolean, sl:number}> = [];
    (emu.bus as any).setHBlankCallback((hb: boolean, sl: number) => hbEvents.push({ hb, sl }));

    // One scanline worth of instruction ticks
    // With IPS=100 and HBLANK_FRAC=10 => visible=90, hblank=10
    (emu.bus as any).tickInstr(100);

    // Expect at least an enter-event into HBlank
    const entered = hbEvents.some(e => e.hb === true);
    expect(entered).toBe(true);
  });

  it('invokes HBlank callback enter/exit and steps APU per scanline in cycle mode', () => {
    process.env.SNES_TIMING_SIM = '1';
    process.env.SNES_TIMING_MODE = 'cycles';

    const emu = Emulator.fromCartridge(makeCart());
    emu.reset();

    const hbEvents: Array<{hb:boolean, sl:number}> = [];
    (emu.bus as any).setHBlankCallback((hb: boolean, sl: number) => hbEvents.push({ hb, sl }));

    // Monkey-patch stepApuScanline to count invocations
    let apuSteps = 0;
    const origStep = (emu.bus as any).stepApuScanline?.bind(emu.bus) || (() => {});
    (emu.bus as any).stepApuScanline = () => { apuSteps++; origStep(); };

    const CYCLES_PER_SCANLINE = 1364;
    // Advance two complete scanlines
    (emu.bus as any).tickCycles(2 * CYCLES_PER_SCANLINE);

    // Expect at least two APU steps (one per scanline)
    expect(apuSteps).toBeGreaterThanOrEqual(2);
    // Expect at least an HBlank enter event and APU to have stepped
    const entered = hbEvents.some(e => e.hb === true);
    expect(entered).toBe(true);
  });
});

