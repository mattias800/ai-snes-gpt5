import { APUDevice } from './src/apu/apu';

const apu = new APUDevice();
(apu as any).setSmpLowPowerDisabled(true);
const smp = (apu as any).smp;

// The APUDevice reset should have already set PC to the reset vector
console.log(`Starting PC = 0x${smp.PC.toString(16).toUpperCase()}`);
console.log(`Starting X = 0x${smp.X.toString(16).toUpperCase()}`);

// Run until X reaches 0 (memory clear loop)
let iterations = 0;
while (iterations < 1000) {
    const prevX = smp.X;
    apu.step(1);
    iterations++;
    if (prevX !== 0 && smp.X === 0) {
        break; // X just became 0
    }
}

console.log(`X reached 0 at iteration ${iterations}`);
console.log(`PC = 0x${smp.PC.toString(16).toUpperCase()}`);

// Now trace the next instructions to see if handshake code runs
console.log('\nNext 20 instructions after loop exit:');

for (let i = 0; i < 20; i++) {
    const prevPC = smp.PC;
    const prevX = smp.X;
    const prevA = smp.A;
    
    // Get opcode from memory (using IPL ROM access)
    const opcode = (apu as any).read8(prevPC);
    
    apu.step(1);
    
    console.log(`PC: 0x${prevPC.toString(16).toUpperCase().padStart(4, '0')} ` +
                `opcode: 0x${opcode.toString(16).toUpperCase().padStart(2, '0')} ` +
                `-> PC: 0x${smp.PC.toString(16).toUpperCase().padStart(4, '0')} ` +
                `A=${smp.A.toString(16).toUpperCase().padStart(2, '0')} ` +
                `X=${smp.X.toString(16).toUpperCase().padStart(2, '0')}`);
    
    // Check if we're writing to ports
    if (prevPC === 0xFFC9 || prevPC === 0xFFCB || prevPC === 0xFFCD) {
        console.log(`  -> Port write expected here`);
    }
}

// Check the port values
console.log('\nPort values after handshake attempt:');
console.log(`Port 0xF4 (CPU sees as 0x2140): 0x${apu.cpuReadPort(0).toString(16).toUpperCase().padStart(2, '0')}`);
console.log(`Port 0xF5 (CPU sees as 0x2141): 0x${apu.cpuReadPort(1).toString(16).toUpperCase().padStart(2, '0')}`);
console.log(`Port 0xF6 (CPU sees as 0x2142): 0x${apu.cpuReadPort(2).toString(16).toUpperCase().padStart(2, '0')}`);
console.log(`Port 0xF7 (CPU sees as 0x2143): 0x${apu.cpuReadPort(3).toString(16).toUpperCase().padStart(2, '0')}`);
