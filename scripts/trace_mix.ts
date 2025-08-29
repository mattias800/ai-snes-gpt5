#!/usr/bin/env tsx
import * as fs from 'fs';
import { APUDevice } from '../src/apu/apu';
import { loadSpcIntoApu } from '../src/apu/spc_loader';

const SMP_CLOCK_HZ = 1024_000;

interface Args { in: string; ms: number; rate: number; mask: number; frames: number; voice: number|null; forcePan: number|null; forcePanMs: number; }

function parseArgs(argv: string[]): Args {
  const a: Record<string,string>={};
  for(const s of argv.slice(2)){ const m=s.match(/^--([^=]+)=(.*)$/); if(m) a[m[1]]=m[2]; }
  const i = a['in']||'yoshi.spc';
  const ms = Number(a['ms']||'60');
  const rate = Number(a['rate']||'32000');
  const mask = a['mask'] ? Number(a['mask']) : (a['voice'] ? (1<<Number(a['voice'])) : 0xff);
  const frames = Math.max(1, Math.round((ms/1000)*rate));
  const voice = a['voice']!=null ? Number(a['voice']) : null;
  const forcePan = a['force-pan']!=null ? Number(a['force-pan']) : null;
  const forcePanMs = Number(a['force-pan-ms']||'0');
  return { in:i, ms, rate, mask, frames, voice, forcePan, forcePanMs };
}

async function main(){
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.in)) throw new Error('SPC not found: '+args.in);
  const apu = new APUDevice();
  loadSpcIntoApu(apu, fs.readFileSync(args.in));

  apu.setVoiceMask(args.mask);
  apu.beginMixTrace(args.frames);

  // Optional: force one voice hard-left for a short window to validate left path
  if (args.forcePan!=null && args.forcePan>=0) {
    const fpFrames = Math.max(1, Math.round((args.forcePanMs/1000)*args.rate));
    apu.setForcePan(args.forcePan, fpFrames);
  }

  const cps = Math.max(1, Math.round(SMP_CLOCK_HZ / args.rate));
  for(let i=0;i<args.frames;i++) { apu.step(cps); apu.mixSample(); }
  apu.endMixTrace();

  const trace = apu.getMixTrace();
  // If first entry is globals snapshot, print it
  if (trace.length>0 && trace[0]?.globals) {
    console.log('globals', trace[0].globals);
  }
  const N = Math.min(trace.length, 20);
  console.log(`Trace frames=${trace.length} (showing first ${N}) mask=0x${args.mask.toString(16)}`);

  for(let i=0;i<N;i++){
    const f = trace[i];
    if (f?.globals) continue;
    if (f?.guard) { console.log('guard', f); continue; }
    const vs = (f.voices||[]) as any[];
    // If a single voice selected, filter
    const list = args.voice==null?vs:vs.filter(v=>v.i===args.voice);
    const summary = list.map(v=>`v${v.i}: s=${v.s.toFixed(2)} env=${v.env.toFixed(3)} vl=${v.vl.toFixed(2)} vr=${v.vr.toFixed(2)}`).join(' | ');
    console.log(`${i}: dryL=${f.dryL.toFixed(2)} dryR=${f.dryR.toFixed(2)} | ${summary}`);
  }

  // Aggregate non-zero counts per voice
  const counts: Record<number,{nzL:number;nzR:number;maxL:number;maxR:number}> = {};
  for (const f of trace) {
    if (f?.globals) continue;
    if (!f?.voices) continue;
    for (const v of f.voices||[]) {
      const c = counts[v.i]||(counts[v.i]={nzL:0,nzR:0, maxL:0, maxR:0});
      const avl = Math.abs(v.vl), avr = Math.abs(v.vr);
      if (avl>0) c.nzL++;
      if (avr>0) c.nzR++;
      if (avl>c.maxL) c.maxL = avl;
      if (avr>c.maxR) c.maxR = avr;
    }
  }
  console.log('nonzero_counts_and_max', counts);
}

main().catch(e=>{console.error(e);process.exit(1);});

