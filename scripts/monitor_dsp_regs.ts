#!/usr/bin/env tsx
import * as fs from 'fs';
import { APUDevice } from '../src/apu/apu';
import { loadSpcIntoApu } from '../src/apu/spc_loader';

const SMP_CLOCK_HZ = 1024_000;

function s8(x: number) { return (x << 24) >> 24; }
function u8(x: number) { return x & 0xff; }

function parseArgs(argv: string[]) {
  const a: Record<string,string>={};
  for(const s of argv.slice(2)){ const m=s.match(/^--([^=]+)=(.*)$/); if(m) a[m[1]]=m[2]; }
  const i = a['in']||'yoshi.spc';
  const ms = Number(a['ms']||'5000');
  const rate = Number(a['rate']||'32000');
  const intervalMs = Number(a['intervalMs']||'100');
  return { in:i, ms, rate, intervalMs };
}

async function main(){
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.in)) throw new Error('SPC not found: '+args.in);
  const apu = new APUDevice();
  loadSpcIntoApu(apu, fs.readFileSync(args.in));
  const anyApu: any = apu as any;
  const regs: Uint8Array = anyApu['dsp']?.['regs'];
  const r8 = (a: number) => u8(regs[a & 0x7f]);

  const totalFrames = Math.max(1, Math.round((args.ms/1000)*args.rate));
  const intervalFrames = Math.max(1, Math.round((args.intervalMs/1000)*args.rate));
  const cps = Math.max(1, Math.round(SMP_CLOCK_HZ / args.rate));

  for (let i=0;i<totalFrames;i++) {
    apu.step(cps);
    apu.mixSample();
    if (i % intervalFrames === 0) {
      const snap = {
        t_ms: Math.round((i/args.rate)*1000),
        MVOLL: s8(r8(0x0c)), MVOLR: s8(r8(0x1c)),
        EVOLL: s8(r8(0x2c)), EVOLR: s8(r8(0x3c)),
        EON: r8(0x4d), KON: r8(0x4c), KOF: r8(0x5c), FLG: r8(0x6c)
      };
      console.log('snap', snap);
    }
  }
}

main().catch(e=>{console.error(e);process.exit(1);});

