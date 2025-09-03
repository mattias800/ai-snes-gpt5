#!/usr/bin/env tsx
import { Cartridge } from '../src/cart/cartridge.js';
import { normaliseRom } from '../src/cart/loader.js';
import { Emulator } from '../src/emulator/core.js';
import fs from 'fs';

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

function rd(emu: Emulator, bank: number, addr: number): number {
  const a = ((bank & 0xff) << 16) | (addr & 0xffff);
  return emu.bus.read8(a) & 0xff;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const romPath = (args.rom as string) || '';
  if (!romPath) {
    console.error('Usage: dump_rom_addr --rom=path.sfc');
    process.exit(2);
  }
  const raw = fs.readFileSync(romPath);
  const { rom } = normaliseRom(new Uint8Array(raw));
  const cart = new Cartridge({ rom });
  const emu = Emulator.fromCartridge(cart);
  emu.reset();

  const checks: [number, number, string][] = [
    [0x00, 0xfffc, '00:FFFC (reset vec lo)'],
    [0x00, 0xfffd, '00:FFFD (reset vec hi)'],
    [0x00, 0xffff, '00:FFFF (test op?)'],
    [0x01, 0x0000, '01:0000 (next bank)'],
    [0x7e, 0xffff, '7E:FFFF (WRAM edge)'],
    [0x7f, 0x0000, '7F:0000 (WRAM next)'],
  ];
  for (const [b,a,label] of checks) {
    const v = rd(emu, b, a);
    console.log(`${label} = $${v.toString(16).padStart(2,'0')}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

