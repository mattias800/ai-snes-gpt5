import { parseCpuVectors, discoverCpuTestsRoot } from '../src/third_party/snesTests/parseCpuVectors';
import * as path from 'path';

function toHex(n: number, w: number) { return (n >>> 0).toString(16).toUpperCase().padStart(w, '0'); }

async function main() {
  const idArg = (process.argv[2] || '').toLowerCase();
  if (!idArg) {
    console.error('Usage: tsx scripts/find_vector.ts <idHex>');
    process.exit(2);
  }
  const ROOT = process.env.SNES_TESTS_DIR || path.resolve('test-roms/snes-tests');
  const { listFile } = discoverCpuTestsRoot(ROOT);
  if (!listFile) {
    console.error('Could not find tests-full.txt or tests-basic.txt');
    process.exit(1);
  }
  const vecs = parseCpuVectors(listFile, { limit: 0 });
  const match = vecs.find(v => v.idHex === idArg);
  if (!match) {
    console.error('No vector with id', idArg);
    process.exit(1);
  }
  const v = match;
  console.log(`[VECTOR ${v.idHex}] ${v.insDisplay}`);
  console.log(' Input:', {
    A: v.input.A, X: v.input.X, Y: v.input.Y, P: v.input.P, E: v.input.E, S: v.input.S,
    D: v.input.D, DBR: v.input.DBR
  });
  console.log(' Operands:', v.operands, 'mode:', v.mode);
  console.log(' memInit:', v.memInit.slice(0, 8));
  console.log(' Expected:', v.expected);
  console.log(' memExpect:', v.memExpect.slice(0, 8));
}

main().catch(e => { console.error(e); process.exit(1); });

