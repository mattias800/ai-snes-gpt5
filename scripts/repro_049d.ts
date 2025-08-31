import { TestMemoryBus } from '../src/bus/testMemoryBus';
import { CPU65C816 } from '../src/cpu/cpu65c816';

function toHex(n: number, w: number) { return (n >>> 0).toString(16).toUpperCase().padStart(w, '0'); }

async function main() {
  const bus = new TestMemoryBus();
  const cpu = new CPU65C816(bus);

  // Vector 049d: sta [$34] in native mode, 16-bit A, D=$FFFF
  cpu.state.E = false; // native
  cpu.state.P = 0x00;  // M=0 (16-bit A), X=0 (16-bit X/Y)
  cpu.state.A = 0x8000;
  cpu.state.X = 0x3456;
  cpu.state.Y = 0x5678;
  cpu.state.D = 0xFFFF;
  cpu.state.DBR = 0x00; // DBR not used for [dp]
  cpu.state.PBR = 0x00;
  cpu.state.S = 0x1FF0;
  cpu.state.PC = 0x8000;

  // Pointer at D+dp with 8-bit dp wrap: D=$FFFF, dp=$34 -> base = $0033
  bus.write8(0x000033, 0xFF);
  bus.write8(0x000034, 0xFF);
  bus.write8(0x000035, 0x7E);

  // Seed initial mem
  const loAddr = (0x7E << 16) | 0xFFFF;
  const hiAddr = (0x7F << 16) | 0x0000;
  bus.write8(loAddr, 0x34);
  bus.write8(hiAddr, 0x12);

  // Assemble STA [#$34]
  const code = new Uint8Array([0x87, 0x34]);
  let a = 0x008000;
  for (const b of code) bus.write8(a++, b);

  ;(process as any).env.CPU_DEBUG = '1';
  console.log(`[SETUP] A_in=$${toHex(cpu.state.A,4)} E=${cpu.state.E?1:0} P=$${toHex(cpu.state.P,2)} D=$${toHex(cpu.state.D,4)}`);
  console.log(`[SETUP] ptr bytes @ base=$0033: ${toHex(bus.read8(0x000033),2)} ${toHex(bus.read8(0x000034),2)} ${toHex(bus.read8(0x000035),2)} -> expect 7E:FFFF`);
  console.log(`[SETUP] before mem[7E:FFFF]=$${toHex(bus.read8(loAddr),2)} mem[7F:0000]=$${toHex(bus.read8(hiAddr),2)}`);

  cpu.stepInstruction();

  console.log(`[RESULT] after mem[7E:FFFF]=$${toHex(bus.read8(loAddr),2)} mem[7F:0000]=$${toHex(bus.read8(hiAddr),2)} A=$${toHex(cpu.state.A & 0xFFFF,4)} P=$${toHex(cpu.state.P & 0xFF,2)}`);
}

main().catch(e => { console.error(e); process.exit(1); });

