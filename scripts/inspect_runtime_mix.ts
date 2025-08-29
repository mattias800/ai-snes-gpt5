#!/usr/bin/env tsx
import * as fs from 'fs';
import { APUDevice } from '../src/apu/apu';
import { loadSpcIntoApu } from '../src/apu/spc_loader';

const SMP_CLOCK_HZ = 1024_000;

async function main(){
  const spcPath = process.argv[2] || 'yoshi.spc';
  const ms = Number(process.argv[3] || '200');
  const rate = 32000;
  if(!fs.existsSync(spcPath)) throw new Error('SPC not found');
  const apu = new APUDevice();
  loadSpcIntoApu(apu, fs.readFileSync(spcPath));
  const anyApu: any = apu as any;
  const dsp: any = anyApu['dsp'];
  const frames = Math.round(ms/1000 * rate);
  const cps = Math.max(1, Math.round(SMP_CLOCK_HZ / rate));
  for(let i=0;i<frames;i++){
    apu.step(cps);
    apu.mixSample();
  }
  console.log('mixDebug', dsp['debug']);
  const v0 = dsp['voices'][0];
  // Manually test ADSR progression
  v0.env = 0; v0.envPhase = 1;
  let last = 0;
  for (let i=0;i<10;i++) last = dsp['updateEnvelope'](v0);
  console.log('envRet', last, 'envPhase', v0.envPhase);
  console.log('v0', {active: v0.active, srcn: v0.srcn, pitch: v0.pitch, volL: v0.volL, volR: v0.volR, h0: v0.h0, env: v0.env, adsr1: v0.adsr1, adsr2: v0.adsr2, gain: v0.gain});
}

main().catch(e=>{console.error(e);process.exit(1);});

