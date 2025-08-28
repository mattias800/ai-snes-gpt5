import { TestMemoryBus } from '../src/bus/testMemoryBus';
import { CPU65C816, Flag } from '../src/cpu/cpu65c816';
import { parseCpuVectors, discoverCpuTestsRoot } from '../src/third_party/snesTests/parseCpuVectors';

function m8FromP_E(P: number, E: boolean): boolean { return E || ((P & Flag.M) !== 0); }
function x8FromP_E(P: number, E: boolean): boolean { return E || ((P & Flag.X) !== 0); }

async function main() {
  const ROOT = process.env.SNES_TESTS_DIR || 'third_party/snes-tests';
  const { listFile } = discoverCpuTestsRoot(ROOT);
  if (!listFile) {
    console.error('No snes-tests list file found');
    process.exit(1);
  }
  const vectors = parseCpuVectors(listFile)
    .filter(v => !v.requiresScaffolding)
    .filter(v => ['adc','and','eor','ora','sbc','bit','asl','lsr','rol','ror','cmp','cpx','cpy','inc','dec'].includes(v.op));

  const targetIdHex = (process.argv[2] || '').toLowerCase();
  const v = targetIdHex ? vectors.find(x => x.idHex === targetIdHex) : vectors[0];
  if (!v) {
    console.error('Vector not found');
    process.exit(1);
  }

  const bus = new TestMemoryBus();
  const cpu = new CPU65C816(bus);

  const E = v.input.E !== 0;
  cpu.state.E = E;
  cpu.state.P = v.input.P & 0xff;

  const m8 = m8FromP_E(cpu.state.P, cpu.state.E);
  const x8 = x8FromP_E(cpu.state.P, cpu.state.E);

  const aMask = m8 ? 0xff : 0xffff;
  const xyMask = x8 ? 0xff : 0xffff;

  cpu.state.A = (v.input.A ?? 0) & aMask;
  cpu.state.X = (v.input.X ?? 0) & xyMask;
  cpu.state.Y = (v.input.Y ?? 0) & xyMask;
  cpu.state.D = (v.input.D ?? 0) & 0xffff;
  cpu.state.DBR = (v.input.DBR ?? 0) & 0xff;
  cpu.state.PBR = 0x00;
  cpu.state.S = v.input.S !== undefined ? (v.input.S & 0xffff) : (E ? 0x01ff : 0x1fff);
  cpu.state.PC = 0x8000;

  for (const m of v.memInit) bus.write8(m.addr24 >>> 0, m.val & 0xff);

  // Assemble the instruction using the existing assembler module
  const { assemble } = await import('../src/third_party/snesTests/assemble65c816');
  let bytes = assemble(v, { m8, x8, e: E });
  let addr = 0x008000;
  for (const b of bytes) bus.write8(addr++, b);

  console.log('Vector', v.idHex, v.insDisplay);
  console.log('Input', { A: cpu.state.A, X: cpu.state.X, Y: cpu.state.Y, P: cpu.state.P, E: cpu.state.E, D: cpu.state.D, DBR: cpu.state.DBR, S: cpu.state.S });
  console.log('memInit len', v.memInit.length);
  for (const m of v.memInit) console.log('memInit', m.addr24.toString(16).padStart(6,'0'), m.val.toString(16).padStart(2,'0'));
  console.log('m8/x8', m8, x8, 'bytes', Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')));

  cpu.stepInstruction();

  console.log('After', { A: cpu.state.A, X: cpu.state.X, Y: cpu.state.Y, P: cpu.state.P, S: cpu.state.S, D: cpu.state.D, DBR: cpu.state.DBR });
  console.log('Expected', v.expected);
  for (const m of v.memExpect) {
    const actual = bus.read8(m.addr24 >>> 0);
    console.log('memExpect', m.addr24.toString(16).padStart(6,'0'), 'exp', m.val.toString(16).padStart(2,'0'), 'got', actual.toString(16).padStart(2,'0'));
  }
}

main().catch(e => { console.error(e); process.exit(1); });

