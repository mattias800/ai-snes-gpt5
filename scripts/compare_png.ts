#!/usr/bin/env tsx
/*
Compare two PNGs pixel-by-pixel. Exit 0 if identical, else 1.

Usage:
  tsx scripts/compare_png.ts --a=path/to/a.png --b=path/to/b.png [--allowDiff=N]

--allowDiff=N permits up to N differing pixels (absolute count) before failing.
*/
import fs from 'fs';
import { PNG } from 'pngjs';

function parseArgs(argv: string[]) {
  const out: Record<string,string|number|boolean> = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) {
      const k = m[1];
      let v: string | number | boolean = m[2];
      if (/^\d+$/.test(v)) v = Number(v);
      out[k] = v;
    } else if (a.startsWith('--')) out[a.slice(2)] = true;
  }
  return out;
}

function loadPng(path: string): Promise<PNG> {
  return new Promise((res, rej) => {
    fs.createReadStream(path)
      .pipe(new PNG())
      .on('parsed', function(this: PNG) { res(this); })
      .on('error', rej);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const a = (args.a as string) || '';
  const b = (args.b as string) || '';
  const allow = Number(args.allowDiff ?? 0);
  if (!a || !b) {
    console.error('Usage: --a=imgA.png --b=imgB.png [--allowDiff=N]');
    process.exit(2);
  }
  const A = await loadPng(a);
  const B = await loadPng(b);
  if (A.width !== B.width || A.height !== B.height) {
    console.error(`Dimension mismatch: A=${A.width}x${A.height} B=${B.width}x${B.height}`);
    process.exit(1);
  }
  const pixels = A.width * A.height;
  let diff = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    if (A.data[i] !== B.data[i] || A.data[i+1] !== B.data[i+1] || A.data[i+2] !== B.data[i+2] || A.data[i+3] !== B.data[i+3]) diff++;
  }
  if (diff > allow) {
    console.error(`PNG mismatch: ${diff} differing pixels (allow <= ${allow})`);
    process.exit(1);
  }
  console.log(`OK: ${pixels - diff}/${pixels} pixels match (diff=${diff})`);
}

main().catch(e => { console.error(e); process.exit(1); });

