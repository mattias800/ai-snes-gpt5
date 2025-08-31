#!/usr/bin/env tsx
/*
CPU trace generator: runs our emulator on a ROM and emits a JSONL instruction-by-instruction trace
with pre-instruction CPU state, matching the typical bsnes-plus "pre-state at PC" trace style.

Usage:
  tsx scripts/cpu_trace.ts --rom=path/to.rom --maxSteps=NNN [--out=trace.jsonl]

Each JSON line contains:
  { step, PBR, PC, A, X, Y, S, D, DBR, P, E, OP }
*/
import fs from 'fs';
import path from 'path';
import { Cartridge } from '../src/cart/cartridge.js';
import { normaliseRom } from '../src/cart/loader.js';
import { Emulator } from '../src/emulator/core.js';

function parseArgs(argv: string[]) {
  const out: Record<string,string|number|boolean> = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) {
      const k = m[1];
      let v: string | number | boolean = m[2];
      if (/^\d+$/.test(v)) v = Number(v);
      out[k] = v;
    } else if (a.startsWith('--')) {
      out[a.slice(2)] = true;
    }
  }
  return out;
}

function snapshot(cpu: any) {
  // Pre-instruction snapshot. Copy scalar fields only to avoid mutation.
  return {
    A: cpu.state.A & 0xffff,
    X: cpu.state.X & 0xffff,
    Y: cpu.state.Y & 0xffff,
    S: cpu.state.S & 0xffff,
    D: cpu.state.D & 0xffff,
    DBR: cpu.state.DBR & 0xff,
    PBR: cpu.state.PBR & 0xff,
    PC: cpu.state.PC & 0xffff,
    P: cpu.state.P & 0xff,
    E: !!cpu.state.E,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const romPath = (args.rom as string) || '';
  if (!romPath) {
    console.error('Error: --rom=path/to.rom is required');
    process.exit(2);
  }
  const maxSteps = Number(args.maxSteps ?? 100000);
  const outPath = (args.out as string) || '';

  const romData = fs.readFileSync(romPath);
  const { rom } = normaliseRom(romData);
  const cart = new Cartridge({ rom });
  const emu = Emulator.fromCartridge(cart);
  emu.reset();

  const out: string[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const pre = snapshot(emu.cpu);
    // Fetch opcode without mutating state (our CPU.fetch8 mutates), so read via bus directly
    const addr24 = ((pre.PBR & 0xff) << 16) | (pre.PC & 0xffff);
    const op = emu.bus.read8(addr24) & 0xff;
    const rec = { step, ...pre, OP: op };
    out.push(JSON.stringify(rec));

    // Execute 1 instruction
    emu.stepInstruction();

    // Stop if STP was executed (no direct flag exposed; heuristic: PC doesn't advance for many cycles)
    // Here we simply continue until maxSteps.
  }

  if (outPath) {
    fs.writeFileSync(outPath, out.join('\n') + '\n', 'utf8');
  } else {
    console.log(out.join('\n'));
  }
}

main();

