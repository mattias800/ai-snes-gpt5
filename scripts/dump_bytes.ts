#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import { normaliseRom } from '../src/cart/loader.js';
import { Cartridge } from '../src/cart/cartridge.js';
import { Emulator } from '../src/emulator/core.js';
import { parseHeader } from '../src/cart/header.js';

function parseBP(s: string) {
  const m = s.trim().replace(/^\$/,'').match(/^([0-9a-fA-F]{2}):([0-9a-fA-F]{4})$/);
  if (!m) throw new Error('bad --bp, expected BB:PPPP');
  return { bank: parseInt(m[1],16)&0xff, pc: parseInt(m[2],16)&0xffff };
}

function hex(n: number, w: number) { return (n>>>0).toString(16).toUpperCase().padStart(w,'0'); }

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a=>{
    const m=a.match(/^--([^=]+)=(.*)$/); return m?[m[1],m[2]]:[a,'1'];
  }));
  const romPath = String(args.rom||'');
  if (!romPath) { console.error('Usage: tsx scripts/dump_bytes.ts --rom=path.sfc --bp=BB:PPPP --n=64'); process.exit(2); }
  const { bank, pc } = parseBP(String(args.bp||'00:82E0'));
  const n = Math.max(1, Math.min(4096, Number(args.n||64)|0));
  const raw = fs.readFileSync(path.resolve(romPath));
  const { rom } = normaliseRom(new Uint8Array(raw));
  const header = parseHeader(rom);
  const cart = new Cartridge({ rom, mapping: header.mapping });
  const emu = Emulator.fromCartridge(cart);
  const start24 = ((bank&0xff)<<16) | (pc&0xffff);
  const bytes: number[] = [];
  for (let i=0;i<n;i++) bytes.push(emu.bus.read8((start24+i)&0xffffff)&0xff);
  let line='';
  for (let i=0;i<bytes.length;i++){
    if (i%16===0){ if(line) console.log(line); line=`${hex(bank,2)}:${hex((pc+i)&0xffff,4)}  `; }
    line += hex(bytes[i],2)+' ';
  }
  if(line) console.log(line);
}

main();

