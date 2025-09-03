import { APUDevice } from './src/apu/apu';

const apu = new APUDevice();
(apu as any).setIoTrace(false);
(apu as any).setSmpLowPowerDisabled(true);

const smp = (apu as any).smp;

console.log('Initial SMP state:');
console.log('PC =', smp.PC.toString(16));
console.log('X =', smp.X.toString(16));
console.log('SP =', smp.SP.toString(16));

// Step through first few instructions
console.log('\nExecuting first instructions:');

// MOV X,#$EF at $FFC0
apu.step(1);
console.log(`After MOV X,#$EF: X=${smp.X.toString(16)}, PC=${smp.PC.toString(16)}`);

// MOV SP,X at $FFC2
apu.step(1);
console.log(`After MOV SP,X: SP=${smp.SP.toString(16)}, PC=${smp.PC.toString(16)}`);

// MOV A,#$00 at $FFC3
apu.step(1);
console.log(`After MOV A,#$00: A=${smp.A.toString(16)}, PC=${smp.PC.toString(16)}`);

// Now we're at the loop start $FFC5
console.log('\nLoop execution (sampling every 16 iterations):');
let lastX = smp.X;
for (let i = 0; i < 300; i++) {
  apu.step(1);
  if (((0xef - smp.X) % 16 === 0) || smp.X < 0x10 || smp.PC >= 0xffc9) {
    console.log(`  Iter ${i}: X=${smp.X.toString(16).padStart(2,'0')}, PC=${smp.PC.toString(16).padStart(4,'0')}`);
  }
  if (smp.PC >= 0xffc9) {
    console.log('Exited loop! Final X =', smp.X.toString(16), 'PC =', smp.PC.toString(16));
    break;
  }
}

console.log('\nNext few instructions after loop:');
for (let i = 0; i < 5; i++) {
  const pc = smp.PC;
  console.log(`PC=${pc.toString(16).padStart(4,'0')}`);
  apu.step(1);
  if (smp.PC === 0xffd0 || smp.PC === 0xffcf) {
    console.log('  -> Reached wait loop without executing handshake!');
    break;
  }
}
