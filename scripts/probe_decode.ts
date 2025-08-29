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
  console.log('start', v.startAddr.toString(16), 'loop', v.loopAddr.toString(16));
  // Prime if needed
  if (!v.primed) {
    dsp['decodeNext'](v); dsp['decodeNext'](v); dsp['decodeNext'](v);
  }
  for (let i = 0; i < 32; i++) {
    const s = dsp['decodeNext'](v);
    console.log(i, s, 'prev1', v.prev1, 'prev2', v.prev2, 'hdr', v.curHeader.toString(16), 'bIndex', v.brrByteIndex, 'rem', v.samplesRemainingInBlock);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

