#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import { SPC_IPL_ROM_U8 } from '../src/apu/spc_ipl.ts';

const outDir = path.resolve('artifacts/mame/roms/s_smp');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'spc700.rom');
const bios = SPC_IPL_ROM_U8.slice(0, 64);
fs.writeFileSync(outPath, Buffer.from(bios));
console.log('Wrote', outPath, `(${bios.length} bytes)`);

