import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { normaliseRom } from '../../src/cart/loader';
import { parseHeader } from '../../src/cart/header';
import { Cartridge } from '../../src/cart/cartridge';
import { Emulator } from '../../src/emulator/core';
import { Scheduler } from '../../src/emulator/scheduler';

const ROM_ENV = 'SMW_ROM';

function boot(romPath: string): Emulator {
  const raw = fs.readFileSync(romPath);
  const { rom } = normaliseRom(new Uint8Array(raw));
  const header = parseHeader(rom);
  const cart = new Cartridge({ rom, mapping: header.mapping });
  const emu = Emulator.fromCartridge(cart);
  emu.reset();
  return emu;
}

// Only run when ROM present; does not require shim tile injection.
const runIf = (process.env[ROM_ENV] && (process.env.SMW_APU_SHIM === '1' || process.env.SMW_APU_SHIM === 'true')) ? describe : describe.skip;

runIf('SMW BG registers transition from defaults (env-gated)', () => {
  it('observes BG1/BG2 char/map base registers change from power-on defaults after N frames', () => {
    const emu = boot(process.env[ROM_ENV]!);
    const ips = Number(process.env.SMW_IPS ?? 800);
    const frames = Number(process.env.SMW_FRAMES ?? 800);
    const sched = new Scheduler(emu, Number.isFinite(ips) ? ips : 800, { onCpuError: 'throw' });

    // Latch initial values
    const initBG1SC = emu.bus.read8(0x00002107) & 0xff;
    const initBG12NBA = emu.bus.read8(0x0000210b) & 0xff;
    const initBG2SC = emu.bus.read8(0x00002108) & 0xff;

    emu.bus.setController1State({ Start: true });

    for (let i = 0; i < frames; i++) sched.stepFrame();

    const bg1sc = emu.bus.read8(0x00002107) & 0xff;
    const bg12nba = emu.bus.read8(0x0000210b) & 0xff;
    const bg2sc = emu.bus.read8(0x00002108) & 0xff;

    // At least one of BG1/BG2 bases should have changed from defaults by this point
    const bg1Changed = (bg1sc !== initBG1SC) || (bg12nba !== initBG12NBA);
    const bg2Changed = (bg2sc !== initBG2SC);

    expect(bg1Changed || bg2Changed).toBe(true);
  });
});

