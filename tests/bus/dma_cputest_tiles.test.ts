import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { normaliseRom } from '../../src/cart/loader';
import { parseHeader } from '../../src/cart/header';
import { Cartridge } from '../../src/cart/cartridge';
import { Emulator } from '../../src/emulator/core';
import { Scheduler } from '../../src/emulator/scheduler';

const ROOT = process.env.SNES_TESTS_DIR || path.resolve('test-roms/snes-tests');

function shouldRun(): boolean {
  return process.env.RUN_SNES_ROMS === '1' || process.env.RUN_SNES_ROMS === 'true';
}

describe('cputest-full DMA tile loading (env-gated)', () => {
  if (!shouldRun()) {
    it.skip('RUN_SNES_ROMS not set; skipping', () => {});
    return;
  }

  const CPU_ROM = path.join(ROOT, 'cputest', 'cputest-full.sfc');
  const haveCPU = fs.existsSync(CPU_ROM);

  (haveCPU ? it : it.skip)('DMA loads font tiles into VRAM $4000', () => {
    // Load and boot the ROM
    const raw = fs.readFileSync(CPU_ROM);
    const { rom } = normaliseRom(new Uint8Array(raw));
    const header = parseHeader(rom);
    const cart = new Cartridge({ rom, mapping: header.mapping });
    const emu = Emulator.fromCartridge(cart);
    emu.reset();

    const sched = new Scheduler(emu, 1000, { onCpuError: 'throw' });
    const ppu = emu.bus.getPPU() as any;

    // Run for more frames to let the ROM setup and DMA execute
    let dmaFound = false;
    for (let f = 0; f < 60; f++) {
      sched.stepFrame();
      // Check if anything changed in VRAM
      if (!dmaFound) {
        for (let i = 0; i < 256; i++) {
          const word = ppu.inspectVRAMWord(0x4000 + i) & 0xffff;
          if (word !== 0) {
            console.log(`DMA detected at frame ${f}, VRAM $4000 has data`);
            dmaFound = true;
            break;
          }
        }
      }
    }
    if (!dmaFound) {
      console.log('No DMA detected in 60 frames');
    }

    // The cputest ROM loads font tiles via DMA from ROM bank 00 offset $CD35
    // With the fix, this should now contain actual font data (non-zero)
    let hasNonZeroAt4000 = false;
    let nonZeroCount = 0;
    for (let i = 0; i < 256; i++) {
      const word = ppu.inspectVRAMWord(0x4000 + i) & 0xffff;
      if (word !== 0) {
        hasNonZeroAt4000 = true;
        nonZeroCount++;
      }
    }

    // Expect font data to be loaded (should have non-zero data)
    expect(hasNonZeroAt4000, 'Expected VRAM $4000 to contain font tile data (non-zero)').toBe(true);
    expect(nonZeroCount).toBeGreaterThan(10); // Expect substantial font data

    // Also check if VRAM address 0x0800 has tile data (alternate location)
    let hasNonZeroAt0800 = false;
    for (let i = 0; i < 256; i++) {
      const word = ppu.inspectVRAMWord(0x0800 + i) & 0xffff;
      if (word !== 0) {
        hasNonZeroAt0800 = true;
        break;
      }
    }

    console.log(`VRAM $4000 has font data: ${hasNonZeroAt4000} (${nonZeroCount} non-zero words)`);
    console.log(`VRAM $0800 has data: ${hasNonZeroAt0800}`);

    // Sample some words from both locations
    console.log('Sample VRAM at $4000:');
    for (let i = 0; i < 8; i++) {
      const word = ppu.inspectVRAMWord(0x4000 + i) & 0xffff;
      console.log(`  [${(0x4000 + i).toString(16)}] = 0x${word.toString(16).padStart(4, '0')}`);
    }

    console.log('Sample VRAM at $0800:');
    for (let i = 0; i < 8; i++) {
      const word = ppu.inspectVRAMWord(0x0800 + i) & 0xffff;
      console.log(`  [${(0x0800 + i).toString(16)}] = 0x${word.toString(16).padStart(4, '0')}`);
    }
  });
});
