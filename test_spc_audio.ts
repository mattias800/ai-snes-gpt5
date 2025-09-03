#!/usr/bin/env tsx
import * as fs from 'fs';
import { APUDevice } from './src/apu/apu';
import { loadSpcIntoApu } from './src/apu/spc_loader';

const spcPath = process.argv[2] || 'test-spc/yoshi_nop.spc';
const gain = parseFloat(process.argv[3] || '20');

console.log('Loading', spcPath, 'with gain', gain);
const spc = fs.readFileSync(spcPath);
const apu = new APUDevice();
loadSpcIntoApu(apu, spc);

const anyApu: any = apu;
const dsp = anyApu.dsp;
dsp.setMixGain(gain);

// Check initial state
console.log('\nInitial voice states:');
for(let i = 0; i < 8; i++) {
  const v = dsp.voices[i];
  if(v.active) {
    console.log(`V${i}: active, srcn=${v.srcn}, env=${v.env.toFixed(3)}, phase=${v.envPhase}, volL=${v.volL}, volR=${v.volR}`);
  }
}

// Run for a while to let envelopes develop and decode samples
console.log('\nRunning 1000 samples...');
let maxL = 0, maxR = 0;
let firstSound = -1;
let sampleCount = 0;

for(let i = 0; i < 1000; i++) {
  apu.step(32);
  const [l, r] = dsp.mixSample();
  
  maxL = Math.max(maxL, Math.abs(l));
  maxR = Math.max(maxR, Math.abs(r));
  
  if(firstSound < 0 && (Math.abs(l) > 100 || Math.abs(r) > 100)) {
    firstSound = i;
    console.log(`First significant sound at sample ${i}: L=${l}, R=${r}`);
  }
  
  // Sample output values
  if(i % 100 === 0 && i > 0) {
    console.log(`Sample ${i}: L=${l}, R=${r}`);
  }
  
  sampleCount++;
}

console.log('\nResults:');
console.log('Samples processed:', sampleCount);
console.log('Max amplitude: L=' + maxL + ', R=' + maxR);
if(firstSound >= 0) {
  console.log('First sound at sample', firstSound);
} else {
  console.log('No significant sound produced');
}

// Final voice states
console.log('\nFinal voice states:');
for(let i = 0; i < 8; i++) {
  const v = dsp.voices[i];
  if(v.active || v.srcn > 0) {
    console.log(`V${i}: active=${v.active}, srcn=${v.srcn}, env=${v.env.toFixed(3)}, phase=${v.envPhase}`);
    console.log(`     h0=${v.h0}, h1=${v.h1}, h2=${v.h2}, h3=${v.h3}`);
  }
}

// Check debug info
console.log('\nDSP debug:', dsp.debug);
