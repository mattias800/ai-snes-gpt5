import { APUDevice } from './src/apu/apu';
import { SPC_IPL_ROM_U8 } from './src/apu/spc_ipl';

const apu = new APUDevice();
(apu as any).setIoTrace(true);
(apu as any).setSmpLowPowerDisabled(true);

const smp = (apu as any).smp;
smp.enableInstrRing(256);

console.log('IPL ROM dump around handshake:');
console.log('$FFC9:', Array.from(SPC_IPL_ROM_U8.slice(9, 12)).map(b => b.toString(16).padStart(2, '0')).join(' '), '// Should be: 8F AA F4');
console.log('$FFCC:', Array.from(SPC_IPL_ROM_U8.slice(12, 15)).map(b => b.toString(16).padStart(2, '0')).join(' '), '// Should be: 8F BB F5');
console.log('$FFCF:', Array.from(SPC_IPL_ROM_U8.slice(15, 18)).map(b => b.toString(16).padStart(2, '0')).join(' '), '// Should be: 78 CC F4 (CMP $F4,#$CC)');

console.log('\nStepping through init...');
// Skip the memory clear loop
for (let i = 0; i < 260; i++) {
  apu.step(10);
  if (smp.PC >= 0xffc9) break;
}

console.log('\nNow at PC =', smp.PC.toString(16));

// Step one instruction at a time
for (let i = 0; i < 20; i++) {
  const pc = smp.PC;
  const opcode = (apu as any).read8(pc);
  
  console.log(`\nPC=${pc.toString(16).padStart(4,'0')} OP=${opcode.toString(16).padStart(2,'0')}`);
  
  if (pc === 0xffc9) {
    console.log('  -> This should be MOV $F4,#$AA (opcode 8F)');
  } else if (pc === 0xffcc) {
    console.log('  -> This should be MOV $F5,#$BB (opcode 8F)');
  } else if (pc === 0xffcf || pc === 0xffd0) {
    console.log('  -> This is the wait loop checking for CC');
  }
  
  apu.step(1);
  
  if (smp.PC === pc) {
    console.log('  PC did not advance! Instruction might be unimplemented.');
    break;
  }
}

console.log('\nPort values after execution:');
console.log('Port 0:', apu.cpuReadPort(0).toString(16).padStart(2, '0'));
console.log('Port 1:', apu.cpuReadPort(1).toString(16).padStart(2, '0'));
