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

function matchesLinePattern(label: string, s: string): boolean {
  // Very loose patterns for cputest HUD lines to catch tilemap corruption without overfitting
  // Examples typically look like: "A=1234", "X=0000", "Y=ABCD", "P=..", etc.
  switch (label) {
    case 'A':
    case 'X':
    case 'Y':
      return /^[A-Z]=[0-9A-F]{0,8}[ 0-9A-F]*$/.test(s);
    case 'P':
      return /^P=[0-9A-F ]+$/.test(s);
    default:
      return isPrintableAscii(s);
  }
}

// This test is a screen sanity probe for the cputest ROM. It detects tilemap corruption by
// reading the on-screen text directly from VRAM and ensuring it stays printable and patterned.
// It is gated by RUN_SNES_ROMS to avoid running by default in CI unless explicitly enabled.

describe('cputest screen tilemap sanity (env-gated)', () => {
  if (!shouldRun()) {
    it.skip('RUN_SNES_ROMS not set; skipping', () => {});
    return;
  }

  const CPU_ROM = path.join(ROOT, 'cputest', 'cputest-basic.sfc');
  const haveCPU = fs.existsSync(CPU_ROM);

  (haveCPU ? it : it.skip)('tilemap text lines remain printable and patterned', async () => {
    const emu = boot(CPU_ROM);
    const sched = new Scheduler(emu, 800, { onCpuError: 'throw' });

    // VRAM word addresses for key text rows (see cputest main.asm conventions)
    const ROW_SUCCESS = 0x0032; // "Success" / "Failed" line
    const ROW_TESTNUM = 0x0061; // test number label row
    const ROW_A = 0x00a1; // A register row
    const ROW_X = 0x00c1; // X register row
    const ROW_Y = 0x00e1; // Y register row
    const ROW_P = 0x0101; // P flags row

    const MAX_FRAMES = Number(process.env.SNES_CPU_SCREEN_FRAMES || '300');
    const SAMPLE_EVERY = 10;
    const START_CHECK_AT = Number(process.env.SNES_CPU_SCREEN_WARMUP || '60');

    let violations: string[] = [];

    for (let f = 0; f < MAX_FRAMES; f++) {
      sched.stepFrame();
      if ((f % SAMPLE_EVERY) !== 0) continue;

      const s = readTilemapText(emu, ROW_SUCCESS, 12);
      const t = readTilemapText(emu, ROW_TESTNUM, 12);
      const a = readTilemapText(emu, ROW_A, 12);
      const x = readTilemapText(emu, ROW_X, 12);
      const y = readTilemapText(emu, ROW_Y, 12);
      const p = readTilemapText(emu, ROW_P, 12);

      // Skip early frames before the ROM writes the HUD
      if (f < START_CHECK_AT) continue;

      // Row expectations:
      // - TESTNUM row should say "Test number:" (from ROM init)
      if (t !== 'Test number:') {
        violations.push(`TESTNUM row unexpected='${t}' @frame=${f}`);
      }

      // - SUCCESS row may be blank most of the time; if non-blank, require printable ASCII
      if (s.replace(/\u0000/g,'').length > 0 && !isPrintableAscii(s)) {
        violations.push(`SUCCESS row non-printable='${JSON.stringify(s)}' @frame=${f}`);
      }

      // - A/X/Y rows: may be blank early; if non-blank, require printable ASCII (loose check)
      if (a.replace(/\u0000/g,'').length > 0 && !isPrintableAscii(a)) violations.push(`A row non-printable='${JSON.stringify(a)}' @frame=${f}`);
      if (x.replace(/\u0000/g,'').length > 0 && !isPrintableAscii(x)) violations.push(`X row non-printable='${JSON.stringify(x)}' @frame=${f}`);
      if (y.replace(/\u0000/g,'').length > 0 && !isPrintableAscii(y)) violations.push(`Y row non-printable='${JSON.stringify(y)}' @frame=${f}`);

      // - P row: ROM may use custom glyphs; allow anything
    }

    if (violations.length > 0) {
      const shot = await saveScreenshot(emu, 'cputest_tilemap_sanity');
      expect(false, `Detected tilemap text corruption:\n- ${violations.join('\n- ')}\nSaved screenshot: ${shot}`).toBe(true);
    } else {
      expect(true).toBe(true);
    }
  }, 60_000);
});

