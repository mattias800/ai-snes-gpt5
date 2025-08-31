import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { normaliseRom } from '../../src/cart/loader';
import { parseHeader } from '../../src/cart/header';
import { Cartridge } from '../../src/cart/cartridge';
import { Emulator } from '../../src/emulator/core';
import { Scheduler } from '../../src/emulator/scheduler';
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

function readTilemapText(emu: Emulator, vramWordAddr: number, len: number): string {
  const ppu = emu.bus.getPPU() as any;
  const chars: number[] = [];
  for (let i = 0; i < len; i++) {
    const w = ppu.inspectVRAMWord((vramWordAddr + i) & 0x7fff) & 0xffff;
    chars.push(w & 0xff);
  }
  return String.fromCharCode(...chars);
}

async function saveScreenshot(emu: Emulator, label: string): Promise<string> {
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

function isPrintableAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

// Same sanity as the basic ROM: ensure the header label "Test number:" is written correctly and stays printable.
// We run with a larger frame budget and faster IPS to move the ROM along.

describe('cputest-full screen tilemap sanity (env-gated)', () => {
  if (!shouldRun()) {
    it.skip('RUN_SNES_ROMS not set; skipping', () => {});
    return;
  }

  const CPU_ROM = path.join(ROOT, 'cputest', 'cputest-full.sfc');
  const haveCPU = fs.existsSync(CPU_ROM);

  (haveCPU ? it : it.skip)('header row is stable and printable', async () => {
    const emu = boot(CPU_ROM);
    const sched = new Scheduler(emu, 1000, { onCpuError: 'throw' });

    const ROW_TESTNUM = 0x0061;
    const MAX_FRAMES = Number(process.env.SNES_CPU_SCREEN_FRAMES || '360');
    const START_CHECK_AT = Number(process.env.SNES_CPU_SCREEN_WARMUP || '90');

    let violations: string[] = [];

    for (let f = 0; f < MAX_FRAMES; f++) {
      sched.stepFrame();
      if (f < START_CHECK_AT) continue;
      const t = readTilemapText(emu, ROW_TESTNUM, 12);
      if (t !== 'Test number:') {
        violations.push(`TESTNUM row unexpected='${t}' @frame=${f}`);
        break;
      }
      if (!isPrintableAscii(t)) {
        violations.push(`TESTNUM row non-printable='${JSON.stringify(t)}' @frame=${f}`);
        break;
      }
    }

    if (violations.length > 0) {
      const shot = await saveScreenshot(emu, 'cputest_full_tilemap_sanity');
      expect(false, `Detected tilemap issues (full ROM):\n- ${violations.join('\n- ')}\nSaved screenshot: ${shot}`).toBe(true);
    } else {
      expect(true).toBe(true);
    }
  }, 90_000);
});

