import * as fs from 'fs';
import * as path from 'path';
import { normaliseRom } from '../src/cart/loader';
import { parseHeader } from '../src/cart/header';
import { Cartridge } from '../src/cart/cartridge';
import { Emulator } from '../src/emulator/core';
import { Scheduler } from '../src/emulator/scheduler';

function boot(romPath: string): Emulator {
  const raw = fs.readFileSync(romPath);
  const { rom } = normaliseRom(new Uint8Array(raw));
  const header = parseHeader(rom);
  const cart = new Cartridge({ rom, mapping: header.mapping });
  const emu = Emulator.fromCartridge(cart);
  emu.reset();
  return emu;
}

function dumpWords(emu: Emulator, start: number, count: number): string {
  const ppu: any = emu.bus.getPPU();
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const addr = (start + i) & 0x7fff;
    const w = ppu.inspectVRAMWord(addr) & 0xffff;
    parts.push(w.toString(16).padStart(4,'0'));
  }
  return parts.join(' ');
}

async function main() {
  const rom = process.argv[2] || 'test-roms/snes-tests/cputest/cputest-basic.sfc';
  const frames = Number(process.argv[3] || '120');
  const emu = boot(rom);
  const sched = new Scheduler(emu, 800, { onCpuError: 'throw' });
  for (let f = 0; f < frames; f++) sched.stepFrame();

  const rows = [0x0032, 0x0061, 0x00a1, 0x00c1, 0x00e1, 0x0101];
  for (const r of rows) {
    const s = dumpWords(emu, r, 12);
    console.log(`VRAM[${r.toString(16)}]: ${s}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

