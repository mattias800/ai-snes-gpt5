import { APUDevice } from './src/apu/apu';

const apu = new APUDevice();
(apu as any).setIoTrace(true); // Turn ON I/O trace

// Enable low-power disabled so SMP actually runs  
(apu as any).setSmpLowPowerDisabled(true);

const smp = (apu as any).smp;

console.log('APU initialized, PC =', smp.PC.toString(16).padStart(4, '0'));
console.log('Stepping APU to reach handshake code...\n');

// Step until we're past the init loop
for (let i = 0; i < 300; i++) {
  apu.step(10);
  
  // Check if we're at or past the handshake code
  if (smp.PC >= 0xffc9 && smp.PC <= 0xffd5) {
    console.log('\n=== At handshake code! PC =', smp.PC.toString(16).padStart(4, '0'), '===');
    
    // Step through the handshake instructions one by one
    for (let j = 0; j < 10; j++) {
      const prevPC = smp.PC;
      apu.step(1);
      console.log(`  Step: PC ${prevPC.toString(16).padStart(4, '0')} -> ${smp.PC.toString(16).padStart(4, '0')}`);
      
      // Check port values
      const port0 = apu.cpuReadPort(0);
      const port1 = apu.cpuReadPort(1);
      if (port0 !== 0 || port1 !== 0) {
        console.log(`    Ports changed! Port0=${port0.toString(16).padStart(2,'0')} Port1=${port1.toString(16).padStart(2,'0')}`);
      }
    }
    break;
  }
}

console.log('\nFinal port values:');
console.log('Port 0:', apu.cpuReadPort(0).toString(16).padStart(2, '0'));
console.log('Port 1:', apu.cpuReadPort(1).toString(16).padStart(2, '0'));
console.log('Port 2:', apu.cpuReadPort(2).toString(16).padStart(2, '0'));
console.log('Port 3:', apu.cpuReadPort(3).toString(16).padStart(2, '0'));
