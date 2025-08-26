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

const runIf = process.env[ROM_ENV] && (process.env.SMW_APU_SHIM === '1' || process.env.SMW_APU_SHIM === 'true') ? describe : describe.skip;

runIf('SMW boot unblank with APU shim (env-gated)', () => {
  it('clears forced blank (INIDISP low 4 bits) within N frames when shim is enabled', () => {
    const emu = boot(process.env[ROM_ENV]!);
    const ips = Number(process.env.SMW_IPS ?? 800);
    const frames = Number(process.env.SMW_FRAMES ?? 600);
    const sched = new Scheduler(emu, Number.isFinite(ips) ? ips : 800, { onCpuError: 'throw' });

    // Deterministic input
    emu.bus.setController1State({ Start: true });

    for (let i = 0; i < frames; i++) sched.stepFrame();

    const inidisp = emu.bus.read8(0x00002100);
    // low 4 bits are brightness 0..15; expect > 0 when unblanked
    expect(inidisp & 0x0f).toBeGreaterThan(0);
  });
});

