import { parseCpuVectors, discoverCpuTestsRoot } from '../src/third_party/snesTests/parseCpuVectors';

const ROOT = process.env.SNES_TESTS_DIR || 'third_party/snes-tests';
const { listFile } = discoverCpuTestsRoot(ROOT);
if (!listFile) {
  console.error('No snes-tests list file found');
  process.exit(1);
}

const idHex = (process.argv[2] || '').toLowerCase();
if (!idHex) {
  console.error('Usage: tsx scripts/print_vector.ts <idHex>');
  process.exit(1);
}

const vectors = parseCpuVectors(listFile, {});
const v = vectors.find(v => v.idHex === idHex);
if (!v) {
  console.error('Vector not found:', idHex);
  process.exit(1);
}

console.log(JSON.stringify({
  idHex: v.idHex,
  ins: v.insDisplay,
  op: v.op,
  mode: v.mode,
  operands: v.operands,
  input: v.input,
  memInit: v.memInit,
  expected: v.expected,
  memExpect: v.memExpect,
}, null, 2));

