import { APUDevice } from './src/apu/apu';

const apu = new APUDevice();
(apu as any).setIoTrace(true);

// Enable low-power disabled so SMP actually runs
(apu as any).setSmpLowPowerDisabled(true);

console.log('APU initialized, PC should be at $FFC0');
console.log('SMP PC:', ((apu as any).smp.PC).toString(16).padStart(4, '0'));

// Step the APU for a while to let the IPL ROM run
console.log('\nStepping APU to run IPL ROM...');
for (let i = 0; i < 100; i++) {
  apu.step(100);
}

// Check the mailbox ports
console.log('\nChecking CPU-visible ports after IPL execution:');
console.log('Port 0 ($2140):', apu.cpuReadPort(0).toString(16).padStart(2, '0'));
console.log('Port 1 ($2141):', apu.cpuReadPort(1).toString(16).padStart(2, '0'));
console.log('Port 2 ($2142):', apu.cpuReadPort(2).toString(16).padStart(2, '0'));
console.log('Port 3 ($2143):', apu.cpuReadPort(3).toString(16).padStart(2, '0'));

console.log('\nExpected: Port 0 = AA, Port 1 = BB');
