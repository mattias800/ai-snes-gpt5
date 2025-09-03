#!/usr/bin/env npx tsx
// Debug SPC internals to understand music engine state

import * as fs from 'fs';

function analyzeSPC(filename: string) {
  const buf = fs.readFileSync(filename);
  const aram = buf.slice(0x100, 0x10100);
  
  console.log(`\n=== ${filename} ===\n`);
  
  // Check timer configuration
  const f1 = aram[0xf1];
  const timerTargets = {
    t0: aram[0xfa],
    t1: aram[0xfb], 
    t2: aram[0xfc]
  };
  
  console.log('Timer Configuration:');
  console.log(`  Control ($F1): $${f1.toString(16).padStart(2, '0')}`);
  console.log(`    Timer 0: ${(f1 & 0x01) ? 'ENABLED' : 'disabled'}, target=${timerTargets.t0}`);
  console.log(`    Timer 1: ${(f1 & 0x02) ? 'ENABLED' : 'disabled'}, target=${timerTargets.t1}`);
  console.log(`    Timer 2: ${(f1 & 0x04) ? 'ENABLED' : 'disabled'}, target=${timerTargets.t2}`);
  
  // Check IRQ vector
  const irqLo = aram[0xfffe];
  const irqHi = aram[0xffff];
  const irqVec = (irqHi << 8) | irqLo;
  console.log(`\nIRQ Vector ($FFFE): $${irqVec.toString(16).padStart(4, '0')}`);
  
  // Try to identify what's at the IRQ handler
  if (irqVec !== 0xffff && irqVec !== 0x0000) {
    console.log(`  IRQ handler code at $${irqVec.toString(16)}:`);
    for (let i = 0; i < 16; i++) {
      const byte = aram[irqVec + i];
      process.stdout.write(` ${byte.toString(16).padStart(2, '0')}`);
    }
    console.log();
    
    // Check if it's a simple RETI (0x7F)
    if (aram[irqVec] === 0x7f) {
      console.log('  -> Empty IRQ handler (just RETI)');
    } else if (aram[irqVec] === 0x2d) { // PUSH A
      console.log('  -> Looks like a real IRQ handler (starts with PUSH A)');
    }
  }
  
  // Check for music engine signatures
  console.log('\nMusic Engine Detection:');
  
  // Look for ASCII strings that indicate engine type
  const textRegions = [
    { start: 0x0000, end: 0x0400 },
    { start: 0x1000, end: 0x1100 },
    { start: 0x2000, end: 0x2100 }
  ];
  
  for (const region of textRegions) {
    for (let i = region.start; i < region.end - 8; i++) {
      const str = String.fromCharCode(...aram.slice(i, i + 8));
      if (str.includes('N-SPC') || str.includes('Nintendo')) {
        console.log(`  Found "N-SPC" at $${i.toString(16)}`);
      }
      if (str.includes('RARE') || str.includes('David')) {
        console.log(`  Found "RARE" signature at $${i.toString(16)}`);
      }
    }
  }
  
  // Check DSP registers for initial voice state
  const dspBase = 0x10100 - 0x100; // DSP regs in file
  console.log('\nInitial DSP Voice State:');
  const kon = buf[dspBase + 0x4c];
  const kof = buf[dspBase + 0x5c];
  console.log(`  KON: $${kon.toString(16).padStart(2, '0')} (${describeBits(kon)})`);
  console.log(`  KOF: $${kof.toString(16).padStart(2, '0')} (${describeBits(kof)})`);
  
  // Check pattern/sequence pointers (common locations)
  console.log('\nPotential Pattern Pointers:');
  const pointerRegions = [
    { addr: 0x40, name: 'Common ptr location 1' },
    { addr: 0x50, name: 'Common ptr location 2' },
    { addr: 0x60, name: 'Common ptr location 3' }
  ];
  
  for (const ptr of pointerRegions) {
    const lo = aram[ptr.addr];
    const hi = aram[ptr.addr + 1];
    const addr = (hi << 8) | lo;
    if (addr >= 0x200 && addr < 0xff00) {
      console.log(`  $${ptr.addr.toString(16)}: -> $${addr.toString(16)} (${ptr.name})`);
      
      // Sample first few bytes at that address
      process.stdout.write('    Data: ');
      for (let i = 0; i < 8; i++) {
        process.stdout.write(`${aram[addr + i].toString(16).padStart(2, '0')} `);
      }
      console.log();
    }
  }
  
  // Look for common music commands in memory
  console.log('\nScanning for music patterns:');
  let patternCount = 0;
  for (let addr = 0x400; addr < 0x8000; addr += 0x100) {
    // Look for sequences that look like note data
    // Common pattern: note, duration, note, duration...
    let looksLikeMusic = true;
    let nonZeroCount = 0;
    
    for (let i = 0; i < 32; i += 2) {
      const note = aram[addr + i];
      const duration = aram[addr + i + 1];
      
      if (note !== 0) nonZeroCount++;
      
      // Notes are typically 0x00-0x7F, durations 0x01-0x40
      if (note > 0x7f && note !== 0xff) looksLikeMusic = false;
      if (duration > 0x80 && duration !== 0xff) looksLikeMusic = false;
    }
    
    if (looksLikeMusic && nonZeroCount > 8) {
      if (patternCount++ < 3) {
        console.log(`  Possible pattern data at $${addr.toString(16)}`);
        process.stdout.write('    Sample: ');
        for (let i = 0; i < 16; i++) {
          process.stdout.write(`${aram[addr + i].toString(16).padStart(2, '0')} `);
        }
        console.log();
      }
    }
  }
  
  if (patternCount > 3) {
    console.log(`  ... and ${patternCount - 3} more pattern regions`);
  }
}

function describeBits(byte: number): string {
  const bits = [];
  for (let i = 0; i < 8; i++) {
    if (byte & (1 << i)) bits.push(`v${i}`);
  }
  return bits.length > 0 ? bits.join(',') : 'none';
}

// Analyze the SPCs
const files = ['test-spc/yoshi.spc'];
for (const file of files) {
  if (fs.existsSync(file)) {
    analyzeSPC(file);
  }
}
