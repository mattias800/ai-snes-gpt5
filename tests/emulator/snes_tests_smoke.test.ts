import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { normaliseRom } from '../../src/cart/loader';
import { parseHeader } from '../../src/cart/header';
import { Cartridge } from '../../src/cart/cartridge';
import { Emulator } from '../../src/emulator/core';
import { Scheduler } from '../../src/emulator/scheduler';

function boot(romPath: string): Emulator {
  const raw = fs.readFileSync(romPath);
  const { rom } = normaliseRom(new Uint8Array(raw));
  const header = parseHeader(rom);
  const cart = new Cartridge({ rom, mapping: header.mapping });
  const emu = Emulator.fromCartridge(cart);
  emu.reset();
  return emu;
}

const ROOT = process.env.SNES_TESTS_DIR || path.resolve('third_party/snes-tests');
const CPU_DIR = path.join(ROOT, 'cputest');
const SPC_DIR = path.join(ROOT, 'spctest');

const runIf = (fs.existsSync(CPU_DIR) || fs.existsSync(SPC_DIR)) ? describe : describe.skip;

runIf('Third-party snes-tests smoke (env/data-gated)', () => {
  it('boots cputest-basic.sfc for some frames without exceptions; PC advances', () => {
    const rom = path.join(CPU_DIR, 'cputest-basic.sfc');
    if (!fs.existsSync(rom)) return; // skip silently if not present
    const emu = boot(rom);
    const startPC = emu.cpu.state.PC;
    const sched = new Scheduler(emu, 800, { onCpuError: 'throw' });
    for (let i = 0; i < 120; i++) sched.stepFrame();
    expect(emu.cpu.state.PC).not.toBe(startPC);
  });

  it('boots cputest-full.sfc for some frames without exceptions (optional)', () => {
    const rom = path.join(CPU_DIR, 'cputest-full.sfc');
    if (!fs.existsSync(rom)) return; // skip silently if not present
    const emu = boot(rom);
    const sched = new Scheduler(emu, 800, { onCpuError: 'throw' });
    for (let i = 0; i < 60; i++) sched.stepFrame();
    // If it ran, we consider this a smoke pass
    expect(true).toBe(true);
  });

  it('boots spctest.sfc for some frames without exceptions (optional)', () => {
    const rom = path.join(SPC_DIR, 'spctest.sfc');
    if (!fs.existsSync(rom)) return;
    const emu = boot(rom);
    const sched = new Scheduler(emu, 800, { onCpuError: 'throw' });
    for (let i = 0; i < 60; i++) sched.stepFrame();
    expect(true).toBe(true);
  });
});
