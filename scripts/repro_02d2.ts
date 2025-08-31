import { TestMemoryBus } from '../src/bus/testMemoryBus';
import { CPU65C816, Flag } from '../src/cpu/cpu65c816';

function toHex(n: number, w: number) { return (n >>> 0).toString(16).toUpperCase().padStart(w, '0'); }

async function main() {
  const bus = new TestMemoryBus();
  const cpu = new CPU65C816(bus);

  // Set up CPU state to match vector 02D2 (lda [$FF])
  cpu.state.E = true; // emulation mode
  cpu.state.P = 0x22; // Z + M flags set in vector; E will force M and X to 1
  cpu.state.A = 0x1234;
  cpu.state.X = 0x3456;
  cpu.state.Y = 0x5678;
  cpu.state.D = 0x0100; // D=256
  cpu.state.DBR = 0x00; // not used for [dp]
  cpu.state.PBR = 0x00;
  cpu.state.S = 0x01ef;
  cpu.state.PC = 0x8000;

  // Seed pointer bytes at D+FF = 0x01FF, D+00 = 0x0100 or non-wrapped D+FF+1=0x0200
  bus.write8(0x0001FF, 0x34);
  bus.write8(0x000200, 0x12);
  bus.write8(0x000201, 0x7F);

  // Seed target memory at 7F:1234 = 128
  const target = (0x7F << 16) | 0x1234;
  bus.write8(target, 0x80);

  // Assemble LDA [#$FF]
  const code = new Uint8Array([0xA7, 0xFF]);
  let a = 0x008000;
  for (const b of code) bus.write8(a++, b);

  // Enable debug
  (process as any).env.CPU_DEBUG = '1';

  console.log(`[SETUP] A_in=$${toHex(cpu.state.A,4)} E=${cpu.state.E?1:0} P=$${toHex(cpu.state.P,2)} D=$${toHex(cpu.state.D,4)}`);
  console.log(`[SETUP] ptr bytes @ D+FF=$${toHex(0x01FF,4)}: ${toHex(bus.read8(0x0001FF),2)} ${toHex(bus.read8(0x000200),2)} ${toHex(bus.read8(0x000201),2)} -> expect 7F:1234`);
  console.log(`[SETUP] mem[7F:1234]=$${toHex(bus.read8(target),2)}`);

  // Execute one instruction
  cpu.stepInstruction();

  console.log(`[RESULT] A=$${toHex(cpu.state.A & 0xFFFF,4)} P=$${toHex(cpu.state.P & 0xFF,2)}`);
}

main().catch(e => { console.error(e); process.exit(1); });

