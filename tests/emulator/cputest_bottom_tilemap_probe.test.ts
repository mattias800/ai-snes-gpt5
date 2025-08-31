import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { normaliseRom } from '../../src/cart/loader';
import { parseHeader } from '../../src/cart/header';
import { Cartridge } from '../../src/cart/cartridge';
import { Emulator } from '../../src/emulator/core';
import { Scheduler } from '../../src/emulator/scheduler';
import { PNG } from 'pngjs';
import { renderMainScreenRGBA } from '../../src/ppu/bg';

const ROOT = process.env.SNES_TESTS_DIR || path.resolve('test-roms/snes-tests');

function shouldRun(): boolean {
  return process.env.RUN_SNES_ROMS === '1' || process.env.RUN_SNES_ROMS === 'true';
}

function boot(romPath: string): Emulator {
  const raw = fs.readFileSync(romPath);
  const { rom } = normaliseRom(new Uint8Array(raw));
  const header = parseHeader(rom);
  const cart = new Cartridge({ rom, mapping: header.mapping });
  const emu = Emulator.fromCartridge(cart);
  emu.reset();
  return emu;
}

async function saveShot(emu: Emulator, label: string): Promise<string> {
  const outDir = path.resolve('artifacts', 'screens');
  fs.mkdirSync(outDir, { recursive: true });
  const file = `${label}_${Date.now()}.png`;
  const outPath = path.join(outDir, file);
  const width = 256, height = 224;
  const rgba = renderMainScreenRGBA(emu.bus.getPPU(), width, height);
  const png = new PNG({ width, height });
  Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength).copy(png.data);
  await new Promise<void>((resolve, reject) => {
    const s = fs.createWriteStream(outPath);
    png.pack().pipe(s);
    s.on('finish', () => resolve());
    s.on('error', (e) => reject(e));
  });
  return outPath;
}

function isPrintableOrZero(ch: number): boolean {
  return ch === 0 || (ch >= 0x20 && ch <= 0x7e);
}

// Probe the lower half of the BG1 tilemap (rows 14..27) to catch corruption: most entries
// should be either zero (blank) or printable ASCII when the ROM uses text tiles.
// This is a coarse signal to detect garbage tile indices.

describe('cputest bottom-half BG1 tilemap probe (env-gated)', () => {
  if (!shouldRun()) {
    it.skip('RUN_SNES_ROMS not set; skipping', () => {});
    return;
  }

  const ROM = path.join(ROOT, 'cputest', 'cputest-full.sfc');
  const have = fs.existsSync(ROM);

  (have ? it : it.skip)('lower half rows are mostly zero or printable', async () => {
    const emu = boot(ROM);
    const sched = new Scheduler(emu, 1000, { onCpuError: 'throw' });

    const MAX_FRAMES = Number(process.env.SNES_CPU_SCREEN_FRAMES || '360');
    const START_CHECK_AT = Number(process.env.SNES_CPU_SCREEN_WARMUP || '120');

    let violations: string[] = [];

    for (let f = 0; f < MAX_FRAMES; f++) {
      sched.stepFrame();
      if (f < START_CHECK_AT) continue;

      const ppu: any = emu.bus.getPPU();
      const base = (ppu.bg1MapBaseWord | 0) >>> 0; // should be 0 in this ROM
      const width = (ppu.bg1MapWidth64 ? 64 : 32) | 0;
      const height = (ppu.bg1MapHeight64 ? 64 : 32) | 0;

      // Guard: only run for 32x32 maps (expected for this ROM)
      if (width !== 32 || height !== 32) break;

      let total = 0;
      let good = 0;
      // Rows 14..27 (visible lower half: 28 rows total at 224px)
      for (let ty = 14; ty <= 27; ty++) {
        for (let tx = 0; tx < 32; tx++) {
          const addr = (base + ty * 32 + tx) & 0x7fff;
          const w = ppu.inspectVRAMWord(addr) & 0xffff;
          const lo = w & 0xff;
          total++;
          if (isPrintableOrZero(lo)) good++;
        }
      }
      const ratio = total > 0 ? good / total : 1;
      if (ratio < 0.9) {
        violations.push(`bottom-half printable ratio too low: ${(ratio * 100).toFixed(1)}% @frame=${f}`);
        break;
      }
    }

    if (violations.length > 0) {
      const shot = await saveShot(emu, 'cputest_bottom_probe');
      expect(false, `Detected bottom-half tilemap issues:\n- ${violations.join('\n- ')}\nSaved screenshot: ${shot}`).toBe(true);
    } else {
      expect(true).toBe(true);
    }
  }, 90_000);
});

