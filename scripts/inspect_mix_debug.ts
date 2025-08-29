#!/usr/bin/env tsx
import * as fs from 'fs';
import { APUDevice } from '../src/apu/apu';
import { loadSpcIntoApu } from '../src/apu/spc_loader';

async function main(){
  const spcPath = process.argv[2] || 'yoshi.spc';
  if(!fs.existsSync(spcPath)) throw new Error('SPC not found: '+spcPath);
  const apu = new APUDevice();
  loadSpcIntoApu(apu, fs.readFileSync(spcPath));
  const anyApu: any = apu as any;
  const dsp: any = anyApu['dsp'];
  for(let i=0;i<64;i++){
    apu.step(32);
    apu.mixSample();
  }
  console.log('debug', dsp['debug']);
}

main().catch(e=>{console.error(e);process.exit(1);});

