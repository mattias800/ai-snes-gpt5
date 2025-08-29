import { CPU65C816, Flag } from '../src/cpu/cpu65c816';
import { TestMemoryBus } from '../src/bus/testMemoryBus';

function hex(v: number, w: number) { return '0x' + (v >>> 0).toString(16).padStart(w, '0'); }

async function main() {
  const bus = new TestMemoryBus();
  const cpu = new CPU65C816(bus);

  // Vector 000b: adc ($34),y
  // Input state
  cpu.state.E = false; // native
  cpu.state.P = 0x01; // C=1
  cpu.state.A = 0x1234;
  cpu.state.X = 0x3456;
  cpu.state.Y = 0x1100;
  cpu.state.D = 0xffff;
  cpu.state.DBR = 0x7e;
  cpu.state.PBR = 0x00;
  cpu.state.S = 0x01ef; // arbitrary
  cpu.state.PC = 0x8000;

  // Write opcode and operand at 00:8000
  // 0x71 opcode: ADC (dp),Y ; operand dp=$34
  bus.write8(0x008000, 0x71);
  bus.write8(0x008001, 0x34);

  // memInit:
  bus.write8(0x000033, 0xdc);
  bus.write8(0x000034, 0xfe);
  // Effective target = DBR: (FEDC + 0x1100) & 0xffff = 7E:0FDC
  bus.write8(0x7e0fdc, 0xcb); // low
  bus.write8(0x7e0fdd, 0xed); // high

  // Enable debug to see internal logs
  (process as any).env.CPU_DEBUG = '1';

  cpu.stepInstruction();

  console.log('After:', {
    A: hex(cpu.state.A & 0xffff, 4),
    P: hex(cpu.state.P & 0xff, 2),
  });
}

main().catch(e => { console.error(e); process.exit(1); });

