import { APUDevice } from './src/apu/apu';

const apu = new APUDevice();
(apu as any).setIoTrace(true);
(apu as any).setSmpLowPowerDisabled(true);

const smp = (apu as any).smp;

console.log('Stepping through initialization to reach handshake...');

// Skip the memory clear loop
for (let i = 0; i < 240; i++) {
  apu.step(10);
  if (smp.PC >= 0xffc9) break;
}

console.log('\nReached handshake code at PC =', smp.PC.toString(16).padStart(4, '0'));
console.log('X =', smp.X.toString(16).padStart(2, '0'));
console.log('A =', smp.A.toString(16).padStart(2, '0'));

// Step through the handshake instructions one by one
console.log('\nStepping through handshake instructions:');

// Should be at $FFC9: 8F AA F4 (MOV $F4,#$AA)
for (let i = 0; i < 3; i++) {
  const pc = smp.PC;
  console.log(`\n${i+1}. PC=${pc.toString(16).padStart(4,'0')}`);
  
  if (pc === 0xffc9) {
    console.log('   Executing: MOV $F4,#$AA');
  } else if (pc === 0xffcc) {
    console.log('   Executing: MOV $F5,#$BB');
  } else if (pc === 0xffcf) {
    console.log('   Now at wait loop (CMP $F4,#$CC)');
    break;
  }
  
  // Step one instruction
  apu.step(1);
  
  console.log('   After execution:');
  console.log(`     Port 0 (APU->CPU): ${apu.cpuReadPort(0).toString(16).padStart(2,'0')}`);
  console.log(`     Port 1 (APU->CPU): ${apu.cpuReadPort(1).toString(16).padStart(2,'0')}`);
}

console.log('\n=== Final state ===');
console.log('Port 0 should be AA:', apu.cpuReadPort(0).toString(16).padStart(2, '0'));
console.log('Port 1 should be BB:', apu.cpuReadPort(1).toString(16).padStart(2, '0'));
