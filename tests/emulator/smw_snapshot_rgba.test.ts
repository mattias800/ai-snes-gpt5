import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { normaliseRom } from '../../src/cart/loader';
import { parseHeader } from '../../src/cart/header';
import { Cartridge } from '../../src/cart/cartridge';
import { Emulator } from '../../src/emulator/core';
import { Scheduler } from '../../src/emulator/scheduler';
import { fnv1aHex } from '../../src/utils/hash';
import { renderBG1RegionRGBA } from '../../src/ppu/bg';

const ROM_ENV = 'SMW_ROM';
const EXPECT_ENV = 'SMW_RGBA_EXPECTED';

function bootEmulator(romPath: string): Emulator {
  const raw = fs.readFileSync(romPath);
  const { rom } = normaliseRom(new Uint8Array(raw));
  const header = parseHeader(rom);
  const cart = new Cartridge({ rom, mapping: header.mapping });
  const emu = Emulator.fromCartridge(cart);
  emu.reset();
  return emu;
}

const runIf = process.env[ROM_ENV] ? describe : describe.skip;

runIf('SMW deterministic RGBA snapshot (env-gated)', () => {
  it('computes FNV-1a hash for a 32x32 BG1 RGBA region after N frames', () => {
    const romPath = process.env[ROM_ENV]!;
    const expected = process.env[EXPECT_ENV] ?? 'ec863dc5';

    const emu = bootEmulator(romPath);
    const ips = Number.isFinite(Number(process.env.SMW_IPS)) ? Math.max(1, Number(process.env.SMW_IPS)) : 200;
    const frames = Number.isFinite(Number(process.env.SMW_FRAMES)) ? Math.max(1, Number(process.env.SMW_FRAMES)) : 180;
    const sched = new Scheduler(emu, ips, { onCpuError: 'throw' });

    // Hold Start for determinism
    emu.bus.setController1State({ Start: true });

    for (let i = 0; i < frames; i++) sched.stepFrame();

    const ppu = emu.bus.getPPU();
    const rgba = renderBG1RegionRGBA(ppu, 32, 32); // Uint8ClampedArray
    const hash = fnv1aHex(rgba);

    expect(hash).toBe(expected);
  });
});

