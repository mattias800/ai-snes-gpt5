import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { normaliseRom } from '../../src/cart/loader';
import { parseHeader } from '../../src/cart/header';
import { Cartridge } from '../../src/cart/cartridge';
import { Emulator } from '../../src/emulator/core';
import { Scheduler } from '../../src/emulator/scheduler';
import { renderMainScreenRGBA } from '../../src/ppu/bg';

async function loadPng(p: string): Promise<PNG> {
  return new Promise((res, rej) => {
    fs.createReadStream(p)
      .pipe(new PNG())
      .on('parsed', function (this: PNG) { res(this); })
      .on('error', rej);
  });
}

describe('PPU golden compare (env-driven)', () => {
  it('matches golden PNG when env is provided', async () => {
    const romPath = process.env.PPU_GOLDEN_ROM;
    const goldenPngPath = process.env.PPU_GOLDEN_PNG;
    if (!romPath || !goldenPngPath) return;
    if (!fs.existsSync(romPath) || !fs.existsSync(goldenPngPath)) return;

    const frames = Number.isFinite(Number(process.env.PPU_FRAMES)) ? Math.max(1, Number(process.env.PPU_FRAMES)) : 180;
    const ips = Number.isFinite(Number(process.env.PPU_IPS)) ? Math.max(1, Number(process.env.PPU_IPS)) : 200;
    const width = Number.isFinite(Number(process.env.PPU_WIDTH)) ? Number(process.env.PPU_WIDTH) : 256;
    const height = Number.isFinite(Number(process.env.PPU_HEIGHT)) ? Number(process.env.PPU_HEIGHT) : 224;

    const raw = fs.readFileSync(romPath);
    const { rom } = normaliseRom(new Uint8Array(raw));
    const header = parseHeader(rom);
    const cart = new Cartridge({ rom, mapping: header.mapping });
    const emu = Emulator.fromCartridge(cart);
    emu.reset();

    const sched = new Scheduler(emu, ips, { onCpuError: 'record', traceEveryInstr: 0 });
    for (let i = 0; i < frames; i++) sched.stepFrame();

    const rgba = renderMainScreenRGBA(emu.bus.getPPU(), width, height);

    const golden = await loadPng(goldenPngPath);
    expect(golden.width).toBe(width);
    expect(golden.height).toBe(height);

    let diff = 0;
    for (let i = 0; i < golden.data.length; i += 4) {
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];
      if (golden.data[i] !== r || golden.data[i+1] !== g || golden.data[i+2] !== b || golden.data[i+3] !== a) diff++;
    }

    const allow = Number.isFinite(Number(process.env.PPU_ALLOW_DIFF)) ? Math.max(0, Number(process.env.PPU_ALLOW_DIFF)) : 0;
    expect(diff, `Differing pixels=${diff}`).toBeLessThanOrEqual(allow);
  });
});

