#!/usr/bin/env tsx
import * as fs from 'fs';
import { APUDevice } from './src/apu/apu';
import { loadSpcIntoApuViaIpl } from './src/apu/spc_loader_ipl';

async function main() {
  const spcPath = process.argv[2] || 'test-spc/yoshi.spc';
  
  if (!fs.existsSync(spcPath)) {
    console.error('SPC file not found:', spcPath);
    process.exit(1);
  }
  
  console.log('Loading SPC file:', spcPath);
  const spcData = fs.readFileSync(spcPath);
  
  const apu = new APUDevice();
  const anyApu: any = apu;
  
  console.log('\n=== Using IPL ROM protocol to load SPC ===\n');
  
  const success = loadSpcIntoApuViaIpl(apu, spcData);
  
  if (!success) {
    console.error('\nFailed to load SPC via IPL ROM protocol');
    process.exit(1);
  }
  
  console.log('\n=== Checking state after IPL load ===\n');
  
  // Check CPU state
  const smp = anyApu.smp;
  console.log('CPU state:');
  console.log('  PC: 0x' + smp.PC.toString(16).padStart(4, '0'));
  console.log('  SP: 0x' + smp.SP.toString(16).padStart(2, '0'));
  console.log('  PSW: 0x' + smp.PSW.toString(16).padStart(2, '0'));
  
  // Check DSP state
  const dsp = anyApu.dsp;
  dsp.writeAddr(0x4c);
  const kon = dsp.readData();
  console.log('\nDSP state:');
  console.log('  KON: 0x' + kon.toString(16).padStart(2, '0'));
  
  // Check timers
  console.log('\nTimer state:');
  console.log('  F1 (control): 0x' + apu.aram[0xF1].toString(16).padStart(2, '0'));
  console.log('  Timer 0 enabled:', (apu.aram[0xF1] & 0x01) !== 0);
  
  // Run for a bit and check if music is progressing
  console.log('\n=== Testing music playback ===\n');
  
  let oldKon = kon;
  let konChanges = 0;
  
  console.log('Running APU for 1000 frames...');
  for (let i = 0; i < 1000; i++) {
    apu.step(32);
    
    if (i % 100 === 0) {
      dsp.writeAddr(0x4c);
      const newKon = dsp.readData();
      if (newKon !== oldKon) {
        konChanges++;
        console.log(`  Frame ${i}: KON changed from 0x${oldKon.toString(16)} to 0x${newKon.toString(16)}`);
        oldKon = newKon;
      }
    }
  }
  
  if (konChanges > 0) {
    console.log('\n✓ SUCCESS! Music is playing - KON register changed ' + konChanges + ' times');
  } else {
    console.log('\n✗ Music is not progressing - KON register unchanged');
    
    // Check where CPU is
    console.log('\nCPU is at PC: 0x' + smp.PC.toString(16).padStart(4, '0'));
    
    // Check the instruction
    const opcode = apu.aram[smp.PC];
    console.log('Opcode: 0x' + opcode.toString(16).padStart(2, '0'));
    
    if (opcode === 0x10 || opcode === 0xD0) {
      console.log('CPU is in a branch loop (likely waiting)');
    }
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
