import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { normaliseRom } from '../../src/cart/loader';
import { parseHeader } from '../../src/cart/header';
import { Cartridge } from '../../src/cart/cartridge';
import { Emulator } from '../../src/emulator/core';
import { Scheduler } from '../../src/emulator/scheduler';
import { parseCpuVectors, discoverCpuTestsRoot } from '../../src/third_party/snesTests/parseCpuVectors';
import { PNG } from 'pngjs';
import { renderMainScreenRGBA } from '../../src/ppu/bg';

const ROOT = process.env.SNES_TESTS_DIR || path.resolve('test-roms/snes-tests');

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
  const ppu = emu.bus.getPPU();
  const chars: number[] = [];
  for (let i = 0; i < len; i++) {
    const w = ppu.inspectVRAMWord((vramWordAddr + i) & 0x7fff) & 0xffff;
    chars.push(w & 0xff);
  }
  return String.fromCharCode(...chars);
}

function shouldRun(): boolean {
  return process.env.RUN_SNES_ROMS === '1' || process.env.RUN_SNES_ROMS === 'true';
}

function padHex(n: number, width: number): string {
  return n.toString(16).toUpperCase().padStart(width, '0');
}
function hex(val: number | undefined, _v: any, name: string): string {
  if (val === undefined || val === null) return '-';
  const w = ((): number => {
    switch (name.toUpperCase()) {
      case 'P': case 'DBR': return 2;
      case 'A': case 'X': case 'Y': case 'S': case 'D': return 4;
      default: return 2;
    }
  })();
  return padHex(val & ((w === 2) ? 0xFF : 0xFFFF), w);
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}_${pad(d.getMilliseconds(), 3)}`;
}

async function saveScreenshot(emu: Emulator, label: string): Promise<string> {
  const outDir = path.resolve('artifacts', 'screens');
  fs.mkdirSync(outDir, { recursive: true });
  const file = `${label}_${timestamp()}.png`;
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

// We treat these as smoke pass/fail probes:
// - Fail the test if the ROM renders "Failed" within a modest frame budget
// - Pass if it renders "Success" early
// - Otherwise, pass as long as "Failed" was not observed (prevents regressions without requiring full completion)

describe('snes-tests ROM pass/fail (env/data gated)', () => {
  if (!shouldRun()) {
    it.skip('RUN_SNES_ROMS not set; skipping', () => {});
    return;
  }

  const CPU_ROM = path.join(ROOT, 'cputest', 'cputest-basic.sfc');
  const SPC_ROM = path.join(ROOT, 'spctest', 'spctest.sfc');

  const haveCPU = fs.existsSync(CPU_ROM);
  const haveSPC = fs.existsSync(SPC_ROM);

  (haveCPU ? it : it.skip)('cpu-basic: must reach "Success" within budget; no early "Failed"', async () => {
    const emu = boot(CPU_ROM);
    const sched = new Scheduler(emu, 800, { onCpuError: 'throw' });
    const MAX_FRAMES = Number(process.env.SNES_CPU_SCREEN_FRAMES || '300');

    let verdict: 'success' | 'fail' | null = null;
    for (let f = 0; f < MAX_FRAMES; f++) {
      sched.stepFrame();
      const s7 = readTilemapText(emu, 0x0032, 7); // "Success" length 7
      if (s7 === 'Success') { verdict = 'success'; break; }
      const f6 = readTilemapText(emu, 0x0032, 6); // "Failed" length 6
      if (f6 === 'Failed') { verdict = 'fail'; break; }
    }

    if (verdict === 'success') {
      expect(true).toBe(true);
      return;
    }

    if (verdict === 'fail') {
      // Read the displayed test number (hex) at VRAM row 0x006E (see cputest main.asm: update_test_num)
      const testHex = readTilemapText(emu, 0x006e, 4).toUpperCase();
      // Provide quick context dump of the four lines following the label row
      const a = readTilemapText(emu, 0x00a1, 12);
      const x = readTilemapText(emu, 0x00c1, 12);
      const y = readTilemapText(emu, 0x00e1, 12);
      const p = readTilemapText(emu, 0x0101, 12);

      // Try to enrich the failure with details from tests-basic.txt or tests-full.txt
      let enriched = '';
      try {
        const { listFile } = discoverCpuTestsRoot(ROOT);
        if (listFile && fs.existsSync(listFile)) {
          const vectors = parseCpuVectors(listFile);
          const v = vectors.find(vv => (vv.idHex || '').toUpperCase() === testHex);
          if (v) {
            const op = v.insDisplay || '';
            const inp = v.input || {} as any;
            const exp = v.expected || {} as any;
            enriched = `\nTest ${testHex} => ${op}\nInput: A=${hex(inp.A, v, 'A')} X=${hex(inp.X, v, 'X')} Y=${hex(inp.Y, v, 'Y')} P=${hex(inp.P, v, 'P')} E=${inp.E ?? ''} S=${hex(inp.S, v, 'S')} D=${hex(inp.D, v, 'D')} DBR=${hex(inp.DBR, v, 'DBR')}\nExpect: A=${hex(exp.A, v, 'A')} X=${hex(exp.X, v, 'X')} Y=${hex(exp.Y, v, 'Y')} P=${hex(exp.P, v, 'P')} S=${hex(exp.S, v, 'S')} D=${hex(exp.D, v, 'D')} DBR=${hex(exp.DBR, v, 'DBR')}`;
          }
        }
      } catch { /* ignore */ }

      const shot = await saveScreenshot(emu, `cputest_${testHex}`);
      expect(false, `CPU cputest FAILED at test #${testHex}. Screen A:${a} X:${x} Y:${y} P:${p}${enriched}\nSaved screenshot: ${shot}`).toBe(true);
      return;
    }

    // No verdict within budget -> fail with guidance
    const probe = readTilemapText(emu, 0x0032, 12);
    const shot = await saveScreenshot(emu, 'cputest_noverdict');
    expect(false, `CPU test produced no verdict within ${MAX_FRAMES} frames (row @0x0032='${probe}'). Increase SNES_CPU_SCREEN_FRAMES to allow more time if needed.\nSaved screenshot: ${shot}`).toBe(true);
  }, 60_000);

  (haveSPC ? it : it.skip)('spctest: must reach "Success" within budget; no early "Failed"', async () => {
    // Ensure real APU core is enabled before constructing the bus
    process.env.APU_SPC700_CORE = process.env.APU_SPC700_CORE || '1';
    const emu = boot(SPC_ROM);
    const sched = new Scheduler(emu, 800, { onCpuError: 'throw' });
    const MAX_FRAMES = Number(process.env.SNES_SPC_SCREEN_FRAMES || '180');

    let verdict: 'success' | 'fail' | null = null;
    for (let f = 0; f < MAX_FRAMES; f++) {
      sched.stepFrame();
      const s7 = readTilemapText(emu, 0x0032, 7);
      if (s7 === 'Success') { verdict = 'success'; break; }
      const f6 = readTilemapText(emu, 0x0032, 6);
      if (f6 === 'Failed') { verdict = 'fail'; break; }
    }

    if (verdict === 'success') {
      expect(true).toBe(true);
      return;
    }

    if (verdict === 'fail') {
      const a = readTilemapText(emu, 0x00a1, 6);
      const x = readTilemapText(emu, 0x00c1, 6);
      const y = readTilemapText(emu, 0x00e1, 6);
      const p = readTilemapText(emu, 0x0101, 6);
      const shot = await saveScreenshot(emu, 'spctest_failed');
      expect(false, `SPC test showed \"Failed\" early; dumps: A:${a} X:${x} Y:${y} P:${p}\nSaved screenshot: ${shot}`).toBe(true);
      return;
    }

    // No verdict within budget -> fail with guidance
    const probe = readTilemapText(emu, 0x0032, 12);
    const shot = await saveScreenshot(emu, 'spctest_noverdict');
    expect(false, `SPC test produced no verdict within ${MAX_FRAMES} frames (row @0x0032='${probe}'). Increase SNES_SPC_SCREEN_FRAMES to allow more time if needed.\nSaved screenshot: ${shot}`).toBe(true);
  }, 90_000);
});
