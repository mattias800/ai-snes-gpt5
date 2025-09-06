#!/usr/bin/env tsx
/*
Compare our CPU JSONL pre-instruction trace against a bsnes-plus trace file.

Usage:
  tsx scripts/cpu_compare_trace.ts --rom=path/to.rom \
    --bsnes=path/to/bsnes_trace.txt --maxSteps=NNN [--failFast=1]

Steps:
  1) Run our emulator to produce an in-memory JSON trace for N steps
  2) Parse bsnes trace file
  3) Compare step-by-step (align by index and PC/PBR). On first mismatch, print a diff and exit 1.
*/
import fs from 'fs';
import { Cartridge } from '../src/cart/cartridge.js';
import { normaliseRom } from '../src/cart/loader.js';
import { Emulator } from '../src/emulator/core.js';
import { parseHeader } from '../src/cart/header.js';
import { parseBsnesTraceFile, BsnesCpuTrace } from '../src/tools/bsnesTrace.js';

function parseArgs(argv: string[]) {
  const out: Record<string,string|number|boolean> = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) {
      const k = m[1];
      let v: string | number | boolean = m[2];
      if (/^\d+$/.test(v)) v = Number(v);
      out[k] = v;
    } else if (a.startsWith('--')) out[a.slice(2)] = true;
  }
  return out;
}

function snapshot(cpu: any) {
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

function diffOne(i: number, ours: any, theirs: BsnesCpuTrace) {
  const fields: (keyof typeof ours)[] = ['PBR','PC','A','X','Y','S','D','DBR','P'];
  const diffs: string[] = [];
  for (const f of fields) {
    const ov = (ours as any)[f];
    const tv = (theirs as any)[f];
    if (tv === undefined) continue; // If bsnes trace lacks field, skip strict compare
    if ((ov >>> 0) !== (tv >>> 0)) diffs.push(`${String(f)} ours=${toHex(f, ov)} theirs=${toHex(f, tv)}`);
  }
  return diffs;
}

function toHex(field: string, v: number) {
  if (field === 'P' || field === 'DBR' || field === 'PBR') return `$${(v & 0xff).toString(16).padStart(2,'0')}`;
  if (field === 'PC') return `$${(v & 0xffff).toString(16).padStart(4,'0')}`;
  return `$${(v & 0xffff).toString(16).padStart(4,'0')}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const romPath = (args.rom as string) || '';
  const bsnesPath = (args.bsnes as string) || '';
  if (!romPath || !bsnesPath) {
    console.error('Usage: --rom=path.sfc --bsnes=trace.txt [--maxSteps=N] [--failFast=1] [--skipOurs=N] [--skipTheirs=N]');
    process.exit(2);
  }
  const maxSteps = Number(args.maxSteps ?? 50000);
  const failFast = (args.failFast as any) ? true : false;
  const skipOurs = Number(args.skipOurs ?? 0);
  const skipTheirs = Number(args.skipTheirs ?? 0);

  const romData = fs.readFileSync(romPath);
  const { rom } = normaliseRom(romData);
  const header = parseHeader(rom);
  const cart = new Cartridge({ rom, mapping: header.mapping });
  const emu = Emulator.fromCartridge(cart);
  emu.reset();

  const bsnesText = fs.readFileSync(bsnesPath, 'utf8');
  const theirTrace = parseBsnesTraceFile(bsnesText);
  if (theirTrace.length === 0) {
    console.error('No records parsed from bsnes trace');
    process.exit(3);
  }

  // Skip initial steps as requested
  for (let i = 0; i < skipOurs; i++) emu.stepInstruction();
  const theirSlice = theirTrace.slice(skipTheirs);

  const limit = Math.min(maxSteps, theirSlice.length);
  let mismatches = 0;

  for (let i = 0; i < limit; i++) {
    const pre = snapshot(emu.cpu);
    const theirs = theirSlice[i];

    // Compare PBR:PC alignment first
    if (((pre.PBR & 0xff) !== (theirs.PBR & 0xff)) || ((pre.PC & 0xffff) !== (theirs.PC & 0xffff))) {
      console.error(`Step ${i}: PC mismatch ours=${(pre.PBR&0xff).toString(16).padStart(2,'0')}:${(pre.PC&0xffff).toString(16).padStart(4,'0')} theirs=${(theirs.PBR&0xff).toString(16).padStart(2,'0')}:${(theirs.PC&0xffff).toString(16).padStart(4,'0')}`);
      process.exit(1);
    }

    const diffs = diffOne(i, pre, theirs);
    if (diffs.length > 0) {
      mismatches++;
      console.error(`Step ${i} @ ${toHex('PBR', pre.PBR)}:${toHex('PC', pre.PC)}: ${diffs.join(' | ')}`);
      if (failFast) process.exit(1);
    }

    // Execute one instruction
    emu.stepInstruction();
  }

  if (mismatches > 0) {
    console.error(`Done with ${mismatches} mismatches over ${limit} steps`);
    process.exit(1);
  }
  console.log(`OK: matched ${limit} steps.`);
}

main().catch(e => { console.error(e); process.exit(1); });

