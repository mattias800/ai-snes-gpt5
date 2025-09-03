#!/usr/bin/env npx tsx
// Analyze SPC files to find wait loops and music engine patterns

import * as fs from 'fs';

function analyzeSPC(filename: string) {
  const buf = fs.readFileSync(filename);
  if (buf.length < 0x10180) {
    console.error('SPC file too small');
    return;
  }

  // Extract SMP registers from header
  const pc = (buf[0x26] << 8) | buf[0x25];
  const a = buf[0x27];
  const x = buf[0x28];
  const y = buf[0x29];
  const psw = buf[0x2a];
  const sp = buf[0x2b];

  console.log(`\n=== ${filename} ===`);
  console.log(`PC: $${pc.toString(16).padStart(4, '0')}`);
  console.log(`A=$${a.toString(16).padStart(2, '0')} X=$${x.toString(16).padStart(2, '0')} Y=$${y.toString(16).padStart(2, '0')} PSW=$${psw.toString(16).padStart(2, '0')} SP=$${sp.toString(16).padStart(2, '0')}`);

  // Get ARAM (starts at offset 0x100)
  const aram = buf.slice(0x100, 0x10100);
  
  // Check I/O ports
  console.log(`\nI/O Ports:`);
  console.log(`  $F4: $${aram[0xf4].toString(16).padStart(2, '0')}`);
  console.log(`  $F5: $${aram[0xf5].toString(16).padStart(2, '0')}`);
  console.log(`  $F6: $${aram[0xf6].toString(16).padStart(2, '0')}`);
  console.log(`  $F7: $${aram[0xf7].toString(16).padStart(2, '0')}`);

  // Disassemble around PC to see what it's doing
  console.log(`\nCode around PC ($${pc.toString(16)}):`);
  for (let addr = Math.max(0, pc - 10); addr < Math.min(0xffff, pc + 20); addr++) {
    const op = aram[addr];
    const isCurrent = addr === pc;
    const marker = isCurrent ? ' <--' : '';
    
    // Basic opcode identification
    let mnemonic = '';
    let bytes = 1;
    switch (op) {
      case 0xe5: mnemonic = 'MOV A,abs'; bytes = 3; break;
      case 0xe4: mnemonic = 'MOV A,dp'; bytes = 2; break;
      case 0x68: mnemonic = 'CMP A,#imm'; bytes = 2; break;
      case 0xd0: mnemonic = 'BNE rel'; bytes = 2; break;
      case 0xf0: mnemonic = 'BEQ rel'; bytes = 2; break;
      case 0x64: mnemonic = 'CMP A,dp'; bytes = 2; break;
      case 0xc4: mnemonic = 'MOV abs,A'; bytes = 3; break;
      case 0xc5: mnemonic = 'MOV dp,A'; bytes = 2; break;
      case 0x8f: mnemonic = 'MOV dp,#imm'; bytes = 3; break;
      case 0x3f: mnemonic = 'CALL abs'; bytes = 3; break;
      case 0x5f: mnemonic = 'JMP abs'; bytes = 3; break;
      case 0x6f: mnemonic = 'RET'; bytes = 1; break;
      case 0xe8: mnemonic = 'MOV A,#imm'; bytes = 2; break;
      case 0x2f: mnemonic = 'BRA rel'; bytes = 2; break;
      default: mnemonic = `DB $${op.toString(16).padStart(2, '0')}`; break;
    }
    
    let operands = '';
    if (bytes > 1) {
      const ops: number[] = [];
      for (let i = 1; i < bytes && addr + i <= 0xffff; i++) {
        ops.push(aram[addr + i]);
      }
      operands = ops.map(b => `$${b.toString(16).padStart(2, '0')}`).join(' ');
    }
    
    console.log(`  $${addr.toString(16).padStart(4, '0')}: ${mnemonic.padEnd(12)} ${operands}${marker}`);
    
    if (bytes > 1) addr += bytes - 1;
  }

  // Look for common wait loop patterns
  console.log('\nDetected patterns:');
  
  // Pattern 1: MOV A,abs / CMP A,#imm / BNE (waiting for port value)
  if (aram[pc] === 0xe5 && aram[pc + 3] === 0x68 && aram[pc + 5] === 0xd0) {
    const addr = (aram[pc + 2] << 8) | aram[pc + 1];
    const cmpVal = aram[pc + 4];
    const branchOff = aram[pc + 6];
    const branchDest = pc + 7 + (branchOff << 24 >> 24);
    console.log(`  Wait loop detected at PC=$${pc.toString(16)}`);
    console.log(`    Checking address $${addr.toString(16)} for value $${cmpVal.toString(16)}`);
    console.log(`    Branches to $${branchDest.toString(16)} if not equal`);
    
    if (addr >= 0xf4 && addr <= 0xf7) {
      console.log(`    -> This is waiting for I/O port ${addr - 0xf0}!`);
    }
  }

  // Pattern 2: MOV A,dp / CMP A,#imm / BNE
  if (aram[pc] === 0xe4 && aram[pc + 2] === 0x68 && aram[pc + 4] === 0xd0) {
    const dp = aram[pc + 1];
    const cmpVal = aram[pc + 3];
    const branchOff = aram[pc + 5];
    const branchDest = pc + 6 + (branchOff << 24 >> 24);
    console.log(`  Wait loop detected at PC=$${pc.toString(16)}`);
    console.log(`    Checking direct page $${dp.toString(16)} for value $${cmpVal.toString(16)}`);
    console.log(`    Branches to $${branchDest.toString(16)} if not equal`);
    
    if (dp >= 0xf4 && dp <= 0xf7) {
      console.log(`    -> This is waiting for I/O port ${dp - 0xf0}!`);
    }
  }

  // Look for music engine signatures
  console.log('\nMusic Engine Detection:');
  
  // Check for common music engine patterns in first 0x400 bytes
  const codeStart = aram.slice(0, 0x400);
  
  // N-SPC signature (Nintendo's player)
  if (codeStart.includes(Buffer.from('N-SPC'))) {
    console.log('  N-SPC engine detected (Nintendo standard)');
  }
  
  // Look for timer setup code (common in music engines)
  const timerSetup = aram[0xfa] || aram[0xfb] || aram[0xfc];
  if (timerSetup) {
    console.log(`  Timer configuration found: T0=$${aram[0xfa].toString(16)} T1=$${aram[0xfb].toString(16)} T2=$${aram[0xfc].toString(16)}`);
  }

  // Check for song/pattern data structures (usually have repeating patterns)
  console.log('\nPotential music data regions:');
  for (let addr = 0x200; addr < 0x8000; addr += 0x100) {
    // Look for sequences of non-zero bytes that might be music data
    let nonZeroCount = 0;
    let hasPattern = false;
    for (let i = 0; i < 0x100; i++) {
      if (aram[addr + i] !== 0) nonZeroCount++;
      // Check for repeating patterns (common in music data)
      if (i >= 8 && aram[addr + i] === aram[addr + i - 8] && 
          aram[addr + i + 1] === aram[addr + i - 7]) {
        hasPattern = true;
      }
    }
    if (nonZeroCount > 0x80 && hasPattern) {
      console.log(`  $${addr.toString(16).padStart(4, '0')}: Dense data with patterns (likely music data)`);
    }
  }

  return { pc, aram };
}

// Analyze multiple files
const files = [
  'test-spc/yoshi.spc',
  'test-spc/zelda/10 Guessing-Game House.spc'
];

for (const file of files) {
  if (fs.existsSync(file)) {
    analyzeSPC(file);
  }
}

console.log('\n=== Patching Strategy ===');
console.log('To auto-play these SPCs, we can:');
console.log('1. Replace the wait loop with a JMP to skip it');
console.log('2. Write the expected value to the port being checked');
console.log('3. Modify the branch to always fail (NOP out the branch)');
console.log('\nThe safest approach is to write the expected value to the port.');
