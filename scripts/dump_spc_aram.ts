#!/usr/bin/env tsx
import * as fs from 'fs';
import { APUDevice } from '../src/apu/apu';
import { loadSpcIntoApu } from '../src/apu/spc_loader';

function parseNum(s: string): number {
  if (s.startsWith('0x') || s.startsWith('0X')) return parseInt(s, 16) >>> 0;
  return parseInt(s, 10) >>> 0;
}

function hex2(n: number) { return (n & 0xff).toString(16).padStart(2, '0'); }
function hex4(n: number) { return (n & 0xffff).toString(16).padStart(4, '0'); }

async function main() {
  const args: Record<string,string> = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  const inPath = args['in'] || args['input'] || './test-spc/yoshi.spc';
  const addr = parseNum(args['addr'] ?? '0x12c0') & 0xffff;
  const len = Math.max(1, Math.min(256, parseNum(args['len'] ?? '64')));
  if (!fs.existsSync(inPath)) throw new Error(`SPC not found: ${inPath}`);
  const buf = fs.readFileSync(inPath);
  const apu = new APUDevice();
  loadSpcIntoApu(apu, buf);
  const end = (addr + len) & 0xffff;
  let out = '';
  let i = 0;
  let a = addr;
  while (i < len) {
    const lineAddr = a;
    const bytes: string[] = [];
    for (let j = 0; j < 16 && i < len; j++, i++) {
      bytes.push(hex2(apu.aram[(a + j) & 0xffff]));
    }
    out += `${hex4(lineAddr)}: ${bytes.join(' ')}\n`;
    a = (a + 16) & 0xffff;
  }
  console.log(out.trimEnd());
}

main().catch((e) => { console.error(e); process.exit(1); });

