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

// Only run when SMW ROM is present and shim is enabled. Recommended to set SMW_APU_SHIM_TILE=0 for ROM-driven activity.
const runIf = process.env[ROM_ENV] && (process.env.SMW_APU_SHIM === '1' || process.env.SMW_APU_SHIM === 'true') ? describe : describe.skip;

runIf('SMW VRAM/CGRAM activity beyond shim baseline (env-gated)', () => {
  it('after N frames, detects non-zero CGRAM entries and non-zero VRAM words', () => {
    const emu = boot(process.env[ROM_ENV]!);
    const ips = Number(process.env.SMW_IPS ?? 800);
    const frames = Number(process.env.SMW_FRAMES ?? 600);
    const sched = new Scheduler(emu, Number.isFinite(ips) ? ips : 800, { onCpuError: 'throw' });

    // Deterministic input
    emu.bus.setController1State({ Start: true });

    for (let i = 0; i < frames; i++) sched.stepFrame();

    const ppu = emu.bus.getPPU();

    // Scan CGRAM for any non-zero color beyond index 0
    let cgramNonZero = 0;
    for (let i = 1; i < 256; i++) {
      if (ppu.inspectCGRAMWord(i) !== 0) { cgramNonZero++; break; }
    }

    // Scan a window of VRAM words for any non-zero content outside of 0x0000..0x001f (avoid tiny boot artifacts)
    let vramNonZero = 0;
    for (let addr = 0x20; addr < 0x2000; addr++) {
      if (ppu.inspectVRAMWord(addr) !== 0) { vramNonZero++; break; }
    }

    expect(cgramNonZero).toBeGreaterThan(0);
    expect(vramNonZero).toBeGreaterThan(0);
  });
});

