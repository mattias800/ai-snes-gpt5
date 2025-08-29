#!/usr/bin/env tsx
import * as fs from 'fs';
import { APUDevice } from '../src/apu/apu';
import { loadSpcIntoApu } from '../src/apu/spc_loader';

const SMP_CLOCK_HZ = 1024_000;

function parseArgs(argv: string[]) {
  const a: Record<string,string>={};
  for(const s of argv.slice(2)){ const m=s.match(/^--([^=]+)=(.*)$/); if(m) a[m[1]]=m[2]; }
  const i = a['in']||'yoshi.spc';
  const ms = Number(a['ms']||'500');
  const rate = Number(a['rate']||'32000');
  return { in:i, ms, rate };
}

async function main(){
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.in)) throw new Error('SPC not found: '+args.in);
  const apu = new APUDevice();
  loadSpcIntoApu(apu, fs.readFileSync(args.in));
  const anyApu: any = apu as any;
  if (anyApu.smp?.enableOpcodeTrace) anyApu.smp.enableOpcodeTrace(true);

  // Step for ms duration, as in audio render
  const frames = Math.max(1, Math.round((args.ms/1000)*args.rate));
  const cps = Math.max(1, Math.round(SMP_CLOCK_HZ / args.rate));
  for (let i=0;i<frames;i++) { apu.step(cps); apu.mixSample(); }

  let stats: any[] = [];
  try { stats = anyApu.smp.getUnknownOpcodeStats?.() || []; } catch {}
  console.log('unknown_opcodes_top', stats.slice(0, 16));
}

main().catch(e=>{console.error(e);process.exit(1);});

