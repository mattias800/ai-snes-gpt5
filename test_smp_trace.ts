import { APUDevice } from './src/apu/apu';
import { SPC_IPL_ROM_U8 } from './src/apu/spc_ipl';

const apu = new APUDevice();
(apu as any).setIoTrace(false); // Turn off I/O trace for cleaner output

// Enable low-power disabled so SMP actually runs
(apu as any).setSmpLowPowerDisabled(true);

// Enable instruction tracing
const smp = (apu as any).smp;
smp.enableInstrRing(64);

console.log('APU initialized');
console.log('SMP PC:', smp.PC.toString(16).padStart(4, '0'));
console.log('IPL ROM bytes at $FFC0-$FFCF:');
const ipl = SPC_IPL_ROM_U8;
console.log(Array.from(ipl.slice(0, 16)).map((b: number) => b.toString(16).padStart(2, '0')).join(' '));
console.log('\nExpected IPL code at $FFCC: 8F AA F4 (MOV $F4,#$AA)');
console.log('Expected IPL code at $FFCF: 8F BB F5 (MOV $F5,#$BB)');

// Step the APU for a limited time
console.log('\nStepping APU to let IPL ROM complete initialization...');
let stepCount = 0;
let lastPC = -1;
for (let i = 0; i < 5000; i++) {
  const prevPC = smp.PC;
  apu.step(10);
  const newPC = smp.PC;
  stepCount++;
  
  // Only log when PC changes significantly
  if (Math.abs(newPC - lastPC) > 2 && newPC !== prevPC) {
    console.log(`Step ${stepCount}: PC ${newPC.toString(16).padStart(4,'0')}`);
    lastPC = newPC;
  }
  
  // Check if we've reached the handshake code
  if (newPC === 0xffcc || newPC === 0xffcf) {
    console.log('  -> At handshake instruction! Breaking...');
    break;
  }
  
  // Check if ports have been set
  const port0 = apu.cpuReadPort(0);
  const port1 = apu.cpuReadPort(1);
  if (port0 === 0xaa && port1 === 0xbb) {
    console.log(`  -> Handshake values detected at step ${stepCount}! Port0=AA, Port1=BB`);
    break;
  }
}

// Get instruction history
console.log('\nInstruction history:');
const ring = smp.getInstrRing();
for (const instr of ring.slice(-20)) {
  if (instr) {
    console.log(`  PC=${instr.pc.toString(16).padStart(4, '0')} OP=${instr.op.toString(16).padStart(2, '0')}`);
  }
}

// Check the mailbox ports
console.log('\nFinal port values:');
console.log('Port 0 ($2140):', apu.cpuReadPort(0).toString(16).padStart(2, '0'));
console.log('Port 1 ($2141):', apu.cpuReadPort(1).toString(16).padStart(2, '0'));
