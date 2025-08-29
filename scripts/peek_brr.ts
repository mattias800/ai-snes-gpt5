#!/usr/bin/env tsx
import * as fs from 'fs';
import { APUDevice } from '../src/apu/apu';
import { loadSpcIntoApu } from '../src/apu/spc_loader';

async function main() {
  const spcPath = process.argv[2] || 'yoshi.spc';
  const vidx = Number(process.argv[3] || '0');
  if (!fs.existsSync(spcPath)) throw new Error('SPC not found: ' + spcPath);
  const apu = new APUDevice();
  const buf = fs.readFileSync(spcPath);
  loadSpcIntoApu(apu, buf);
  const anyApu: any = apu as any;
  const dsp: any = anyApu['dsp'];
  const v = dsp['voices'][vidx];
  const start = v.startAddr >>> 0;
  const loop = v.loopAddr >>> 0;
  console.log('voice', vidx, 'start', start.toString(16), 'loop', loop.toString(16));
  const aram: Uint8Array = apu.aram;
  const dump = Array.from(aram.slice(start, (start + 64) & 0xffff)).map(x => x.toString(16).padStart(2,'0')).join(' ');
  console.log('brr@start', dump);
}

main().catch((e) => { console.error(e); process.exit(1); });

