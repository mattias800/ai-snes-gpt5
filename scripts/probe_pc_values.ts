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
  if (!romPath) { console.error('Usage: tsx scripts/probe_pc_values.ts --rom=path.sfc [--max=N]'); process.exit(2); }
  const raw = fs.readFileSync(path.resolve(romPath));
  const { rom } = normaliseRom(new Uint8Array(raw));
  const cart = new Cartridge({ rom });
  const emu = Emulator.fromCartridge(cart);
  emu.reset();

  const targets = new Set([
    0x00cc98, 0x00ccbe, 0x01802e,
    0x008be6, 0x008c9a, 0x00999e
  ]);
  for (let i = 0; i < maxSteps; i++) {
    const cpu: any = emu.cpu;
    const addr24 = ((cpu.state.PBR & 0xff) << 16) | (cpu.state.PC & 0xffff);
    if (targets.has(addr24 >>> 0)) {
      const A = cpu.state.A & 0xffff;
      const X = cpu.state.X & 0xffff;
      const Y = cpu.state.Y & 0xffff;
      const P = cpu.state.P & 0xff;
      const S = cpu.state.S & 0xffff;
      const D = cpu.state.D & 0xffff;
      const DBR = cpu.state.DBR & 0xff;
      const PBR = cpu.state.PBR & 0xff;
      const v12 = emu.bus.read8(0x000012) & 0xff;
      const v13 = emu.bus.read8(0x000013) & 0xff;
      const v18 = emu.bus.read8(0x000018) & 0xff;
      const v19 = emu.bus.read8(0x000019) & 0xff;
      const v7f002f = emu.bus.read8(0x7f002f) & 0xff;
      console.log(`[HIT ${hex(PBR,2)}:${hex(cpu.state.PC,4)} step=${i}] A=${hex(A,4)} X=${hex(X,4)} Y=${hex(Y,4)} P=${hex(P,2)} S=${hex(S,4)} D=${hex(D,4)} DBR=${hex(DBR,2)} mem12=${hex(v12,2)}${hex(v13,2)} mem18=${hex(v18,2)}${hex(v19,2)} 7F:002F=${hex(v7f002f,2)}`);
      process.exit(0);
    }
    emu.stepInstruction();
  }
  console.log('Done; no target PCs observed.');
}

main().catch(e => { console.error(e); process.exit(1); });

