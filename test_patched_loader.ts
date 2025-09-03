#!/usr/bin/env tsx
import * as fs from 'fs';
import { APUDevice } from './src/apu/apu';
import { loadSpcIntoApuPatched } from './src/apu/spc_loader_patched';

const spcPath = process.argv[2] || 'test-spc/yoshi.spc';

console.log('Loading SPC with wait loop patching:', spcPath);
const spcData = fs.readFileSync(spcPath);

const apu = new APUDevice();
const anyApu: any = apu as any;

// Enable timer IRQ injection as well
apu.setTimerIrqInjection(true);

// Load with patching
loadSpcIntoApuPatched(apu, spcData);

const dsp = anyApu.dsp;
dsp.setMixGain(20);

// Check initial state
console.log('\nInitial state:');
const smp = anyApu.smp;
console.log('PC: 0x' + smp.PC.toString(16).padStart(4, '0'));

dsp.writeAddr(0x4c);
const initialKon = dsp.readData();
console.log('KON: 0x' + initialKon.toString(16).padStart(2, '0'));

// Test if music progresses
console.log('\nRunning APU for 5000 cycles...');
let oldKon = initialKon;
let konChanges = 0;
let dspWrites = 0;
let lastF2 = apu.aram[0xF2];

for (let i = 0; i < 5000; i++) {
  apu.step(32);
  
  // Check for DSP writes
  if (apu.aram[0xF2] !== lastF2) {
    dspWrites++;
    lastF2 = apu.aram[0xF2];
  }
  
  // Check KON changes every 100 cycles
  if (i % 100 === 0) {
    dsp.writeAddr(0x4c);
    const newKon = dsp.readData();
    if (newKon !== oldKon) {
      konChanges++;
      console.log(`Cycle ${i}: KON changed from 0x${oldKon.toString(16)} to 0x${newKon.toString(16)}`);
      oldKon = newKon;
    }
  }
}

console.log('\nResults:');
console.log('DSP writes:', dspWrites);
console.log('KON changes:', konChanges);

if (konChanges > 0 || dspWrites > 10) {
  console.log('\n✓ SUCCESS! Music is progressing!');
} else {
  console.log('\n✗ Music still not progressing');
  console.log('Final PC: 0x' + smp.PC.toString(16).padStart(4, '0'));
  const opcode = apu.aram[smp.PC];
  console.log('Opcode at PC: 0x' + opcode.toString(16).padStart(2, '0'));
}
