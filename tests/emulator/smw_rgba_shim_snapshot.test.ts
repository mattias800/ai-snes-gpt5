import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { normaliseRom } from '../../src/cart/loader';
import { parseHeader } from '../../src/cart/header';
import { Cartridge } from '../../src/cart/cartridge';
import { Emulator } from '../../src/emulator/core';
import { Scheduler } from '../../src/emulator/scheduler';
import { renderMainScreenRGBA } from '../../src/ppu/bg';

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

runIf('SMW RGBA snapshot with shim (env-gated)', () => {
  it('produces non-black top-left pixel due to shim-injected BG1 tile', () => {
    const emu = boot(process.env[ROM_ENV]!);
    const ips = Number(process.env.SMW_IPS ?? 800);
    const frames = Number(process.env.SMW_FRAMES ?? 600);
    const sched = new Scheduler(emu, Number.isFinite(ips) ? ips : 800, { onCpuError: 'throw' });

    emu.bus.setController1State({ Start: true });
    for (let i = 0; i < frames; i++) sched.stepFrame();

    const rgba = renderMainScreenRGBA(emu.bus.getPPU(), 1, 1);
    // Expect red-ish due to injected tile + palette
    expect(rgba[0]).toBeGreaterThan(100);
    expect(rgba[1]).toBeLessThan(50);
    expect(rgba[2]).toBeLessThan(50);
  });
});

