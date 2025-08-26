import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { normaliseRom } from '../../src/cart/loader';
import { parseHeader } from '../../src/cart/header';
import { Cartridge } from '../../src/cart/cartridge';
import { Emulator } from '../../src/emulator/core';
import { Scheduler } from '../../src/emulator/scheduler';
import { fnv1aHex } from '../../src/utils/hash';
import { renderBG1RegionIndices } from '../../src/ppu/bg';

// Env variables:
//  - SMW_ROM: path to Super Mario World ROM (headered or unheadered). Test is skipped if not set.
//  - SMW_EXPECTED_HASH: optional expected FNV-1a hex hash for the sampled region. If not set, we log the computed hash.

const ROM_ENV = 'SMW_ROM';
const EXPECT_ENV = 'SMW_EXPECTED_HASH';

function sampleBG1Indices32x32(emu: Emulator, x0 = 64, y0 = 64, w = 32, h = 32): number[] {
  // For now, we don't have a real-time renderer. We'll reuse the helper that renders BG1 indices
  // based on the PPU's BG1 registers and VRAM state.
  const ppu = emu.bus.getPPU();
  // Ensure positive bounds per minimal 256x224 visible area assumptions in tests.
  const W = 256, H = 224;
  if (x0 + w > W || y0 + h > H) throw new Error('Sample rect out of bounds');

  // Render only the region we need by calling the helper for width/height and slicing.
  // We render the full 256x224 would be wasteful; the helper supports arbitrary sizes from 0,0,
  // so compute indices starting from PPU scroll offsets aligned to x0,y0 by temporarily adjusting scroll.
  const savedH = ppu.bg1HOfs;
  const savedV = ppu.bg1VOfs;
  // Shift scroll so that (0,0) in render corresponds to (x0,y0) in original space
  ppu.bg1HOfs = (ppu.bg1HOfs + x0) >>> 0;
  ppu.bg1VOfs = (ppu.bg1VOfs + y0) >>> 0;
  try {
    const indices: number[] = renderBG1RegionIndices(ppu, w, h);
    return indices;
  } finally {
    ppu.bg1HOfs = savedH;
    ppu.bg1VOfs = savedV;
  }
}

function bootEmulator(romPath: string): Emulator {
  const raw = fs.readFileSync(romPath);
  const { rom } = normaliseRom(new Uint8Array(raw));
  const header = parseHeader(rom);
  const cart = new Cartridge({ rom, mapping: header.mapping });
  const emu = Emulator.fromCartridge(cart);
  emu.reset();
  return emu;
}

function holdStart(bus: Emulator['bus']): void {
  bus.setController1State({ Start: true });
}

const runIf = process.env[ROM_ENV] ? describe : describe.skip;

runIf('SMW deterministic 32x32 BG1 snapshot (env-gated)', () => {
  it('computes stable FNV-1a hash for a 32x32 region after N frames', () => {
    const romPath = process.env[ROM_ENV]!;
    const expected = process.env[EXPECT_ENV] ?? '1f116dc5';

    const emu = bootEmulator(romPath);
    const ips = Number.isFinite(Number(process.env.SMW_IPS)) ? Math.max(1, Number(process.env.SMW_IPS)) : 200;
    const sched = new Scheduler(emu, ips, { onCpuError: 'throw' }); // fail-fast on CPU errors for correctness

    // Deterministic input: hold Start from the beginning
    holdStart(emu.bus);

    // Run a small, fixed number of frames. Tune if needed for stability.
    const frames = Number.isFinite(Number(process.env.SMW_FRAMES)) ? Math.max(1, Number(process.env.SMW_FRAMES)) : 180;
    for (let i = 0; i < frames; i++) sched.stepFrame();

    // Sample 32x32 indices from BG1 near the center
    const indices = sampleBG1Indices32x32(emu, 64, 64, 32, 32);
    const hash = fnv1aHex(indices);

    expect(hash).toBe(expected);
  });
});

