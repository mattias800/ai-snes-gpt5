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
  const frames = Number(process.argv[3] || '100');
  const anyApu: any = apu as any;
  const dsp: any = anyApu['dsp'];
  const voices: any[] = dsp?.['voices'];
  for (let i = 0; i < frames; i++) {
    apu.step(32);
    const [l, r] = apu.mixSample();
    const v0 = voices?.[0];
    const v1 = voices?.[1];
    const v0s = v0 ? { h0: v0.h0, env: v0.env, volL: v0.volL, volR: v0.volR, pitch: v0.pitch, active: v0.active } : {};
    const v1s = v1 ? { h0: v1.h0, env: v1.env, volL: v1.volL, volR: v1.volR, pitch: v1.pitch, active: v1.active } : {};
    console.log(i, l, r, '|', 'v0', v0s, 'v1', v1s);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

