#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import { Cartridge } from '../src/cart/cartridge.ts';
import { normaliseRom } from '../src/cart/loader.ts';
import { Emulator } from '../src/emulator/core.ts';

function arg(name: string, def?: string) {
  const pref = `--${name}=`;
  for (const a of process.argv.slice(2)) if (a.startsWith(pref)) return a.slice(pref.length);
  return def;
}

function hex(n: number, w: number) { return (n >>> 0).toString(16).toUpperCase().padStart(w, '0'); }

async function main() {
  const romPath = arg('rom');
  const maxSteps = Number(arg('max', '200000')!);
  if (!romPath) {
    console.error('Usage: tsx scripts/probe_pbr.ts --rom=path.sfc [--max=N]');
    process.exit(2);
  }
  const raw = fs.readFileSync(path.resolve(romPath));
  const { rom } = normaliseRom(new Uint8Array(raw));
  const cart = new Cartridge({ rom });
  const emu = Emulator.fromCartridge(cart);
  emu.reset();

  let lastPbr = (emu.cpu as any).state.PBR & 0xff;
  for (let i = 0; i < maxSteps; i++) {
    const cpu: any = emu.cpu;
    const PBR = cpu.state.PBR & 0xff;
    const PC = cpu.state.PC & 0xffff;
    if ((PBR & 0xff) !== (lastPbr & 0xff)) {
      console.log(`[PBR-CHANGE] step=${i} ${hex(lastPbr,2)} -> ${hex(PBR,2)} at ${hex(PBR,2)}:${hex(PC,4)}`);
      lastPbr = PBR & 0xff;
      if (PBR === 0x01) {
        console.log(`[HIT] Entered bank 01 at step ${i} PC=${hex(PC,4)}`);
        process.exit(0);
      }
    }
    emu.stepInstruction();
  }
  console.log('Done; no entry into bank 01 observed within step budget.');
}

main().catch(e => { console.error(e); process.exit(1); });

