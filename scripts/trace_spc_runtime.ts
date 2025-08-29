#!/usr/bin/env tsx
import * as fs from 'fs';
import { APUDevice } from '../src/apu/apu';
import { loadSpcIntoApu } from '../src/apu/spc_loader';

const SMP_CLOCK_HZ = 1024_000;

type VoiceSnap = {
  active: boolean; srcn: number; pitch: number; volL: number; volR: number; h0: number; env: number;
};

function snapVoices(dsp: any): VoiceSnap[] {
  const out: VoiceSnap[] = [];
  const voices: any[] = dsp['voices'];
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i];
    out.push({ active: !!v.active, srcn: v.srcn|0, pitch: v.pitch|0, volL: v.volL|0, volR: v.volR|0, h0: v.h0|0, env: +v.env });
  }
  return out;
}

function diffVoices(prev: VoiceSnap[], cur: VoiceSnap[]): string[] {
  const diffs: string[] = [];
  for (let i = 0; i < cur.length; i++) {
    const a = prev[i], b = cur[i];
    if (!a || !b) continue;
    const parts: string[] = [];
    if (a.active !== b.active) parts.push(`active:${a.active}->${b.active}`);
    if (a.srcn !== b.srcn) parts.push(`srcn:${a.srcn}->${b.srcn}`);
    if (a.pitch !== b.pitch) parts.push(`pitch:${a.pitch}->${b.pitch}`);
    if (a.volL !== b.volL || a.volR !== b.volR) parts.push(`vol(${a.volL},${a.volR})->(${b.volL},${b.volR})`);
    // Log envelope/sample changes when becoming active or when sample crosses threshold
    if (!a.active && b.active) parts.push(`h0:${b.h0} env:${b.env.toFixed(3)}`);
    const aMag = Math.abs(a.h0|0), bMag = Math.abs(b.h0|0);
    if (bMag >= 8 && aMag < 8) parts.push(`h0:${a.h0}->${b.h0}`);
    if (parts.length) diffs.push(`V${i} ` + parts.join(' '));
  }
  return diffs;
}

async function main() {
  const spcPath = process.argv[2] || 'yoshi.spc';
  const ms = Number(process.argv[3] || '1000');
  const rate = Number(process.argv[4] || '32000');
  if (!fs.existsSync(spcPath)) throw new Error('SPC not found: ' + spcPath);

  const apu = new APUDevice();
  loadSpcIntoApu(apu, fs.readFileSync(spcPath));
  const anyApu: any = apu as any;
  const dsp: any = anyApu['dsp'];
  const regs: Uint8Array = dsp['regs'];
  const r = (a: number) => regs[a & 0x7f] & 0xff;

  // Report initial DSP globals
  console.log('DSP init', {
    FLG: r(0x6c).toString(16), MVOLL: (r(0x0c)<<24>>24), MVOLR: (r(0x1c)<<24>>24),
    EVOLL: (r(0x2c)<<24>>24), EVOLR: (r(0x3c)<<24>>24), EON: r(0x4d).toString(16), DIR: r(0x5d), ESA: r(0x6d), EDL: r(0x7d)&0x0f,
    KON: r(0x4c).toString(16), KOF: r(0x5c).toString(16)
  });

  const frames = Math.round(ms/1000 * rate);
  const cps = Math.max(1, Math.round(SMP_CLOCK_HZ / rate));
  let prevVoices = snapVoices(dsp);
  let lastKon = r(0x4c), lastKof = r(0x5c);
  let changes = 0;

  for (let i = 0; i < frames; i++) {
    apu.step(cps);
    apu.mixSample();
    const curKon = r(0x4c), curKof = r(0x5c);
    const vSnap = snapVoices(dsp);
    const diffs = diffVoices(prevVoices, vSnap);
    if (curKon !== lastKon || curKof !== lastKof || diffs.length) {
      const tMs = (i / rate) * 1000;
      if (curKon !== lastKon) console.log(`[${tMs.toFixed(2)} ms] KON ${lastKon.toString(16)} -> ${curKon.toString(16)}`);
      if (curKof !== lastKof) console.log(`[${tMs.toFixed(2)} ms] KOF ${lastKof.toString(16)} -> ${curKof.toString(16)}`);
      for (const d of diffs) console.log(`[${tMs.toFixed(2)} ms] ${d}`);
      changes++;
      lastKon = curKon; lastKof = curKof; prevVoices = vSnap;
    }
  }
  if (changes === 0) console.log('No DSP changes observed during trace window.');
}

main().catch(e => { console.error(e); process.exit(1); });

