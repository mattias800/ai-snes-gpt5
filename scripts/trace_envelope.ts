#!/usr/bin/env tsx
import * as fs from 'fs';
import { APUDevice } from '../src/apu/apu';
import { loadSpcIntoApu } from '../src/apu/spc_loader';

const SMP_CLOCK_HZ = 1024_000;

async function main(){
  const spcPath = process.argv[2] || 'yoshi.spc';
  const rate = 32000;
  if(!fs.existsSync(spcPath)) throw new Error('SPC not found');
  const apu = new APUDevice();
  loadSpcIntoApu(apu, fs.readFileSync(spcPath));
  const anyApu: any = apu as any;
  const dsp: any = anyApu['dsp'];
  dsp.setTraceEnvelope?.(true);
  const cps = Math.round(SMP_CLOCK_HZ / rate);
  for(let i=0;i<128;i++){
    apu.step(cps);
    apu.mixSample();
  }
  console.log('envTrace', dsp.getEnvelopeTrace?.());
}

main().catch(e=>{console.error(e);process.exit(1);});

