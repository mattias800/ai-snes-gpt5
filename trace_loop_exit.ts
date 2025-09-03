import { APUDevice } from './src/apu/apu';

const apu = new APUDevice();
(apu as any).setIoTrace(false);
(apu as any).setSmpLowPowerDisabled(true);

const smp = (apu as any).smp;
smp.enableInstrRing(128);

console.log('Tracing loop exit behavior...\n');

// Execute until X is very small
for (let i = 0; i < 237; i++) {
  apu.step(1);
}

console.log('Near end of loop:');
console.log(`X = ${smp.X.toString(16).padStart(2,'0')}, PC = ${smp.PC.toString(16).padStart(4,'0')}`);

// Trace the final iterations
for (let i = 0; i < 10; i++) {
  const beforeX = smp.X;
  const beforeZ = (smp.PSW & 0x02) ? 1 : 0;
  const beforePC = smp.PC;
  
  // Read the opcode
  const opcode = (apu as any).read8(beforePC);
  
  apu.step(1);
  
  const afterX = smp.X;
  const afterZ = (smp.PSW & 0x02) ? 1 : 0;
  const afterPC = smp.PC;
  
  console.log(`PC=${beforePC.toString(16).padStart(4,'0')} op=${opcode.toString(16).padStart(2,'0')} X:${beforeX.toString(16).padStart(2,'0')}->${afterX.toString(16).padStart(2,'0')} Z:${beforeZ}->${afterZ} -> PC=${afterPC.toString(16).padStart(4,'0')}`);
  
  if (beforeX === 0 && opcode === 0xd0) {
    console.log('  ^ This is the branch that should fail when X=0 after DEC X!');
    console.log('    BNE should not branch when Z=1');
    console.log('    Next PC should be FFC9 (fall through)');
  }
  
  if (afterPC === 0xffc9 || afterPC === 0xffcf) {
    console.log('  ^ Exited loop!');
    break;
  }
}
