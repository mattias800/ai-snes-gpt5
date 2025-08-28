import { parseCpuVectors, discoverCpuTestsRoot } from '../src/third_party/snesTests/parseCpuVectors';

const idArg = process.argv[2];
if (!idArg) {
  console.error('Usage: tsx scripts/dump_cpu_vector.ts <hex_id>');
  process.exit(1);
}
const hexId = idArg.toLowerCase().replace(/^0x/, '');
const root = process.env.SNES_TESTS_DIR || 'third_party/snes-tests';
const { listFile } = discoverCpuTestsRoot(root);
if (!listFile) {
  console.error('No tests list file found under', root);
  process.exit(2);
}
const vecs = parseCpuVectors(listFile);
const v = vecs.find(v => v.idHex === hexId);
if (!v) {
  console.error('Vector not found for id', hexId);
  process.exit(3);
}
console.log(JSON.stringify(v, null, 2));

