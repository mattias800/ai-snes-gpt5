import { TestMemoryBus } from '../src/bus/testMemoryBus';
import { CPU65C816 } from '../src/cpu/cpu65c816';

const bus = new TestMemoryBus();
// Vector 0003 setup
// DP pointer at 00:FF33 -> FFFF
bus.write8(0x00_ff33, 0xff);
bus.write8(0x00_ff34, 0xff);
// DBR:7E operand bytes: 7E:FFFF=CB, 7E:0000=ED
bus.write8(0x7e_ffff, 0xcb);
bus.write8(0x7e_0000, 0xed);

// Write instruction at 00:8000: ADC ($10,X)
bus.write8(0x00_8000, 0x61);
bus.write8(0x00_8001, 0x10);

const cpu = new CPU65C816(bus);
cpu.state.E = false;
cpu.state.P = 0x01; // C set
cpu.state.A = 0x1234;
cpu.state.X = 0x0123;
cpu.state.Y = 0x5678;
cpu.state.D = 0xff00;
cpu.state.DBR = 0x7e;
cpu.state.PBR = 0x00;
cpu.state.PC = 0x8000;

cpu.stepInstruction();

console.log({ A: cpu.state.A.toString(16), P: cpu.state.P.toString(16) });

