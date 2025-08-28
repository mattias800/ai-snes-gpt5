import { TestMemoryBus } from '../src/bus/testMemoryBus';
import { CPU65C816 } from '../src/cpu/cpu65c816';

const bus = new TestMemoryBus();
// Seed as in vector 0003
// DP pointer is synthesized to D + ((dp + Xlow) & 0xff) = $FF33, value -> $FFFF
bus.write8(0x00_ff33, 0xff);
bus.write8(0x00_ff34, 0xff);
// Target operand at DBR:$FFFF = $CB, DBR:$0000 = $ED (for 16-bit read -> $EDCB)
bus.write8(0x7e_ffff, 0xcb);
bus.write8(0x7e_0000, 0xed);

const cpu = new CPU65C816(bus);
// Set up CPU state as per vector
cpu.state.E = false;
cpu.state.P = 0x01; // C set, M=0
cpu.state.D = 0xff00;
cpu.state.DBR = 0x7e;
cpu.state.X = 0x0123;

const dp = 0x10;
const ptr = (cpu.state.D + ((dp + (cpu.state.X & 0xff)) & 0xff)) & 0xffff;
const loPtr = bus.read8(0x00_0000 + ptr);
const hiPtr = bus.read8(0x00_0000 + ((ptr + 1) & 0xffff));
const eff = ((hiPtr << 8) | loPtr) & 0xffff;

const lo = bus.read8((cpu.state.DBR << 16) | eff);
const hi = bus.read8((cpu.state.DBR << 16) | ((eff + 1) & 0xffff));
const m = ((hi << 8) | lo) & 0xffff;

console.log({ ptr: ptr.toString(16), eff: eff.toString(16), loPtr, hiPtr, lo, hi, m: m.toString(16) });

