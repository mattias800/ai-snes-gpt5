import { SPC_IPL_ROM_U8 } from './src/apu/spc_ipl';

console.log('IPL ROM first instructions:');
console.log(`$FFC0: ${SPC_IPL_ROM_U8[0].toString(16).padStart(2,'0')} ${SPC_IPL_ROM_U8[1].toString(16).padStart(2,'0')} = CD EF = MOV X,#$EF`);
console.log(`$FFC2: ${SPC_IPL_ROM_U8[2].toString(16).padStart(2,'0')}       = BD    = MOV SP,X`);
console.log(`$FFC3: ${SPC_IPL_ROM_U8[3].toString(16).padStart(2,'0')} ${SPC_IPL_ROM_U8[4].toString(16).padStart(2,'0')} = E8 00 = MOV A,#$00`);

console.log('\nLet me check what opcode BD actually does in our implementation...');
console.log('Opcode BD should be MOV SP,X (set SP from X)');
console.log('Opcode 9D should be MOV SP,X according to comments');
console.log('Opcode BD might be MOV X,SP instead!');
