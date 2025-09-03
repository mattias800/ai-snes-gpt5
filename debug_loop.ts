import { APUDevice } from './src/apu/apu';

const apu = new APUDevice();
(apu as any).setIoTrace(false);
(apu as any).setSmpLowPowerDisabled(true);

const smp = (apu as any).smp;

console.log('Stepping through initialization:');

// MOV X,#$EF
let cycles = smp.stepInstruction();
console.log(`1. MOV X,#$EF (${cycles} cycles): X=${smp.X.toString(16)}`);

// MOV SP,X  
const beforeX = smp.X;
const beforeSP = smp.SP;
cycles = smp.stepInstruction();
console.log(`2. MOV SP,X (${cycles} cycles): X was ${beforeX.toString(16)}, now ${smp.X.toString(16)}; SP was ${beforeSP.toString(16)}, now ${smp.SP.toString(16)}`);

// MOV A,#$00
cycles = smp.stepInstruction();
console.log(`3. MOV A,#$00 (${cycles} cycles): A=${smp.A.toString(16)}`);

console.log('\nNow at loop start, PC =', smp.PC.toString(16), 'X =', smp.X.toString(16));
console.log('P flag (direct page) =', (smp.PSW & 0x20) ? '1' : '0');

// First loop iteration
console.log('\nFirst loop iteration:');
// MOV (X),A at $FFC5
console.log(`Before MOV (X),A: X=${smp.X.toString(16)}, A=${smp.A.toString(16)}`);
apu.step(1);
console.log(`After MOV (X),A: X=${smp.X.toString(16)}, PC=${smp.PC.toString(16)}`);

// DEC X at $FFC6
console.log(`Before DEC X: X=${smp.X.toString(16)}`);
apu.step(1);
console.log(`After DEC X: X=${smp.X.toString(16)}, PC=${smp.PC.toString(16)}, Z=${(smp.PSW & 0x02) ? '1' : '0'}`);
