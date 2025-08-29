#!/usr/bin/env tsx
import * as fs from 'fs';
import { APUDevice } from '../src/apu/apu';
import { loadSpcIntoApu } from '../src/apu/spc_loader';

async function main() {
  const spcPath = process.argv[2] || 'yoshi.spc';
  if (!fs.existsSync(spcPath)) throw new Error('SPC not found: ' + spcPath);
  const apu = new APUDevice();
  const buf = fs.readFileSync(spcPath);
  loadSpcIntoApu(apu, buf);
  const anyApu: any = apu as any;
  const dsp: any = anyApu['dsp'];
  const voices: any[] = dsp?.['voices'];
  if (!voices) throw new Error('voices not accessible');
  console.log('Voices runtime state (after load, before KON):');
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i];
    console.log(`V${i}`, {
      volL: v.volL, volR: v.volR, pitch: v.pitch, srcn: v.srcn,
      active: v.active, env: v.env, envPhase: v.envPhase
    });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

