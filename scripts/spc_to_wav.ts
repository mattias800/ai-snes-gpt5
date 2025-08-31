#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { APUDevice } from '../src/apu/apu';
import { loadSpcIntoApu } from '../src/apu/spc_loader';

const SMP_CLOCK_HZ = 1024_000; // ~1.024 MHz SMP

interface CliArgs {
  in: string;
  out: string;
  seconds: number;
  rate: number;
  channels: 1 | 2;
  allowSilence: boolean;
  gain: number;
  prerollMs: number;
  mask: number | null;
  forcePan: number | null;
  forcePanMs: number;
  nullIrqIplHle: boolean;
  apuIplHle: boolean;
  rewriteNullIrq: boolean;
  traceMs: number;
  traceSmp: boolean;
  traceMix: boolean;
  traceIo: boolean;
  timerIrq: boolean;
  dumpInit: boolean;
  traceDecode: number;
  traceKon: boolean;
  traceTimersMs: number;
  traceDspIo: number;
  smpNoLowPower: boolean;
  mapIplRom: boolean;
  logDspKeys: boolean;
  logDspParams: boolean;
  freezeSmp: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string> = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  const inPath = args['in'] || args['input'] || 'yoshi.spc';
  const outPath = args['out'] || args['output'] || 'out.wav';
  const seconds = Number(args['seconds'] || args['secs'] || '10');
  const rate = Number(args['rate'] || '32000');
  const channels = Number(args['channels'] || '2');
  const allowSilence = (args['allow-silence'] === '1' || args['allowSilence'] === '1');
  const gain = Number(args['gain'] || '1');
  const prerollMs = Number(args['preroll-ms'] || args['preroll'] || '200');
  const mask = args['mask'] != null ? Number(args['mask']) : null;
  const forcePan = args['force-pan'] != null ? Number(args['force-pan']) : null;
  const forcePanMs = Number(args['force-pan-ms'] || '0');
  // Allow CLI flags to override, otherwise fall back to env defaults
  const nullIrqIplHle = (args['null-irq-ipl-hle'] ?? process.env.APU_NULL_IRQ_IPL_HLE ?? '1') === '1';
  const apuIplHle = (args['apu-ipl-hle'] ?? process.env.APU_IPL_HLE ?? '0') === '1';
  const rewriteNullIrq = (args['rewrite-null-irq'] ?? process.env.APU_REWRITE_NULL_IRQ ?? '0') === '1';
  const traceMs = Number(args['trace-ms'] ?? '0');
  const traceSmp = (args['trace-smp'] ?? '0') === '1';
  const traceMix = (args['trace-mix'] ?? '0') === '1';
  const traceIo = (args['trace-io'] ?? process.env.APU_TRACE_IO ?? '0') === '1';
  const timerIrq = (args['timer-irq'] ?? process.env.APU_TIMER_IRQ ?? '0') === '1';
  const dumpInit = (args['dump-init'] ?? process.env.APU_DUMP_INIT ?? '0') === '1';
  const traceDecode = Number(args['trace-decode'] ?? '0');
  const traceKon = (args['trace-kon'] ?? '0') === '1';
  const traceTimersMs = Number(args['trace-timers-ms'] ?? '0');
  const traceDspIo = Number(args['trace-dspio'] ?? '0');
  const smpNoLowPower = (args['smp-no-lowpower'] ?? '0') === '1';
  const mapIplRom = (args['map-ipl-rom'] ?? process.env.APU_MAP_IPL_ROM ?? '1') === '1';
  const logDspKeys = (args['log-dsp-keys'] ?? '0') === '1';
  const logDspParams = (args['log-dsp-params'] ?? '0') === '1';
  const freezeSmp = (args['freeze-smp'] ?? '0') === '1';
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Invalid --seconds');
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid --rate');
  if (channels !== 1 && channels !== 2) throw new Error('Invalid --channels (1 or 2)');
  if (!Number.isFinite(gain) || gain <= 0) throw new Error('Invalid --gain');
  if (!Number.isFinite(prerollMs) || prerollMs < 0) throw new Error('Invalid --preroll-ms');
  if (mask != null && (!Number.isFinite(mask) || mask < 0 || mask > 0xff)) throw new Error('Invalid --mask (0..255)');
  if (forcePan != null && (!Number.isFinite(forcePan) || forcePan < 0 || forcePan > 7)) throw new Error('Invalid --force-pan (0..7)');
  if (!Number.isFinite(forcePanMs) || forcePanMs < 0) throw new Error('Invalid --force-pan-ms');
  if (!Number.isFinite(traceMs) || traceMs < 0) throw new Error('Invalid --trace-ms');
  if (!Number.isFinite(traceTimersMs) || traceTimersMs < 0) throw new Error('Invalid --trace-timers-ms');
  if (!Number.isFinite(traceDspIo) || traceDspIo < 0) throw new Error('Invalid --trace-dspio');
  return { in: inPath, out: outPath, seconds, rate, channels: channels as 1 | 2, allowSilence, gain, prerollMs, mask, forcePan, forcePanMs, nullIrqIplHle, apuIplHle, rewriteNullIrq, traceMs, traceSmp, traceMix, traceIo, timerIrq, dumpInit, traceDecode, traceKon, traceTimersMs, traceDspIo, smpNoLowPower, mapIplRom, logDspKeys, logDspParams, freezeSmp };
}

function writeWavPCM16LE(samples: Int16Array, sampleRate: number, channels: number): Buffer {
  const numSamples = samples.length; // already includes channel interleave
  const byteRate = sampleRate * channels * 2; // 16-bit
  const blockAlign = channels * 2;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  let o = 0;
  buf.write('RIFF', o); o += 4;
  buf.writeUInt32LE(36 + dataSize, o); o += 4;
  buf.write('WAVE', o); o += 4;
  // fmt chunk
  buf.write('fmt ', o); o += 4;
  buf.writeUInt32LE(16, o); o += 4;              // PCM chunk size
  buf.writeUInt16LE(1, o); o += 2;               // PCM format
  buf.writeUInt16LE(channels, o); o += 2;
  buf.writeUInt32LE(sampleRate, o); o += 4;
  buf.writeUInt32LE(byteRate, o); o += 4;
  buf.writeUInt16LE(blockAlign, o); o += 2;
  buf.writeUInt16LE(16, o); o += 2;              // bits per sample
  // data chunk
  buf.write('data', o); o += 4;
  buf.writeUInt32LE(dataSize, o); o += 4;
  // samples
  for (let i = 0; i < numSamples; i++) {
    buf.writeInt16LE(samples[i], o); o += 2;
  }
  return buf;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.in)) throw new Error(`Input SPC not found: ${args.in}`);
  const spcBuf = fs.readFileSync(args.in);

  const apu = new APUDevice();
  apu.setMixGain(args.gain);
  // Toggle HLE behaviors per args/env
  apu.setIplHleForNullIrqVectors(args.nullIrqIplHle);
  apu.setBootIplHle(args.apuIplHle);
  apu.setIoTrace(!!args.traceIo);
  // Optional: disable SMP low-power (STOP/SLEEP) to force forward progress for drivers using IPL helpers
  apu.setSmpLowPowerDisabled(!!args.smpNoLowPower);
  // Control whether to map the real IPL ROM at $FFC0-$FFFF (default on). Disabling lets the SPC snapshot's vectors be used.
  apu.setMapIplRom(!!args.mapIplRom);
  // Timer IRQ injection (off by default)
  apu.setTimerIrqInjection(!!args.timerIrq);
  // Focused DSP write logging
  apu.setDspWriteLogging(!!args.logDspKeys, !!args.logDspParams);
  if (args.rewriteNullIrq) { (process as any).env = { ...(process as any).env, APU_REWRITE_NULL_IRQ: '1' }; }
  loadSpcIntoApu(apu, spcBuf);
  if (args.mask != null) apu.setVoiceMask(args.mask);
  if (args.forcePan != null && args.forcePanMs > 0) {
    const frames = Math.max(1, Math.round((args.forcePanMs/1000) * args.rate));
    apu.setForcePan(args.forcePan, frames);
  }

  // Optional initial dump of CPU state and memory near vectors and PC
  if (args.dumpInit) {
    const anyApu: any = apu as any;
    const smp: any = anyApu['smp'];
    const pc = (smp?.PC ?? 0) & 0xffff;
    const sp = (smp?.SP ?? 0) & 0xff;
    const a = (smp?.A ?? 0) & 0xff;
    const x = (smp?.X ?? 0) & 0xff;
    const y = (smp?.Y ?? 0) & 0xff;
    const psw = (smp?.PSW ?? 0) & 0xff;
    const hex2 = (n: number) => (n & 0xff).toString(16).padStart(2, '0');
    const hex4 = (n: number) => (n & 0xffff).toString(16).padStart(4, '0');
    const dump = (base: number, len: number) => {
      const out: string[] = [];
      for (let i = 0; i < len; i++) out.push(hex2(apu.aram[(base + i) & 0xffff]));
      return out.join(' ');
    };
    const vLo = apu.aram[0xffde] & 0xff, vHi = apu.aram[0xffdf] & 0xff;
    const vec = ((vHi << 8) | vLo) & 0xffff;
    // eslint-disable-next-line no-console
    console.log(`[INIT] PC=${hex4(pc)} SP=${hex2(sp)} A=${hex2(a)} X=${hex2(x)} Y=${hex2(y)} PSW=${hex2(psw)} IRQVEC=${hex4(vec)} (lo=${hex2(vLo)} hi=${hex2(vHi)})`);
    // eslint-disable-next-line no-console
    console.log(`[INIT] @PC ${hex4(pc)}: ${dump(pc, 32)}`);
    // eslint-disable-next-line no-console
    console.log(`[INIT] @FF00: ${dump(0xff00, 32)} ...`);
    // eslint-disable-next-line no-console
    console.log(`[INIT] @FFDE: ${dump(0xffd0, 32)} ...`);

    // Inspect sample directory entries used by current voices
    try {
      const dspRegs: Uint8Array | undefined = (anyApu['dsp']?.['regs']) as Uint8Array | undefined;
      if (dspRegs) {
        const dir = dspRegs[0x5d] & 0xff;
        const dirBase = (dir << 8) & 0xffff;
        // eslint-disable-next-line no-console
        console.log(`[INIT] DIR=${hex2(dir)} DIR_BASE=${hex4(dirBase)} (showing directory for SRCNs in current regs)`);
        console.log(`[INIT] DIR DUMP @${hex4(dirBase)}: ${dump(dirBase, 32)}`);
        const voices: { v:number; srcn:number; start:number; loop:number; hdr:string }[] = [];
        for (let v = 0; v < 8; v++) {
          const srcn = dspRegs[(v<<4) + 0x04] & 0xff;
          const base = (dirBase + (srcn * 4)) & 0xffff;
          const sLo = apu.aram[base] & 0xff; const sHi = apu.aram[(base+1)&0xffff] & 0xff;
          const lLo = apu.aram[(base+2)&0xffff] & 0xff; const lHi = apu.aram[(base+3)&0xffff] & 0xff;
          const start = ((sHi<<8) | sLo) & 0xffff;
          const loop = ((lHi<<8) | lLo) & 0xffff;
          const hdr = dump(start, 8);
          voices.push({ v, srcn, start, loop, hdr });
        }
        for (const it of voices) {
          // eslint-disable-next-line no-console
          console.log(`[INIT] V${it.v} SRCN=${it.srcn} START=${hex4(it.start)} LOOP=${hex4(it.loop)} HDR=${it.hdr}`);
        }
      }
    } catch {}
  }

  const totalFrames = Math.floor(args.seconds * args.rate);
  const totalSamples = totalFrames * args.channels;
  const pcm = new Int16Array(totalSamples);

  // Time-based stepping: cycles per output sample derived from SMP clock
  const cyclesPerSample = Math.max(1, Math.round(SMP_CLOCK_HZ / args.rate));

  // Helpers to trace state during preroll/capture
  const anyApu: any = apu as any;
  const dsp: any = anyApu['dsp'];
  // Initial timers dump
  try {
    const ctrl = (anyApu['controlReg'] ?? 0) & 0xff;
    const t0 = anyApu['t0'] as any; const t1 = anyApu['t1'] as any; const t2 = anyApu['t2'] as any;
    const t0t = t0?.getTarget?.() ?? -1; const t1t = t1?.getTarget?.() ?? -1; const t2t = t2?.getTarget?.() ?? -1;
    const t0c = t0?.readCounter?.() ?? -1; const t1c = t1?.readCounter?.() ?? -1; const t2c = t2?.readCounter?.() ?? -1;
    console.log(`[TIMERS][init] F1=${ctrl.toString(16).padStart(2,'0')} t0={en=${(ctrl&1)?1:0} tgt=${t0t} cnt=${t0c}} t1={en=${(ctrl&2)?1:0} tgt=${t1t} cnt=${t1c}} t2={en=${(ctrl&4)?1:0} tgt=${t2t} cnt=${t2c}}`);
  } catch {}
  // Enable a small instruction ring for SMP so we can dump on failure
  try { anyApu['smp']?.enableInstrRing?.(512); } catch {}
  // Optional: begin a limited DSP mix trace to inspect early frames
  if (args.traceMix) {
    try { (apu as any).beginMixTrace?.(64); } catch {}
  }
  if (args.traceDecode > 0) {
    try { (apu as any)['dsp']?.setDecodeTrace?.(args.traceDecode|0); } catch {}
  }
  const dumpTrace = (phase: 'preroll' | 'render', frameIndex: number) => {
    const tMs = Math.round((frameIndex / args.rate) * 1000);
    const parts: string[] = [];
    parts.push(`[TRACE][${phase}] t=${tMs}ms f=${frameIndex}`);
    if (args.traceSmp) {
      try {
        const smp: any = anyApu['smp'];
        const pc = ((smp?.PC ?? 0) & 0xffff).toString(16).padStart(4, '0');
        const psw = ((smp?.PSW ?? 0) & 0xff).toString(16).padStart(2, '0');
        const a = ((smp?.A ?? 0) & 0xff).toString(16).padStart(2, '0');
        const x = ((smp?.X ?? 0) & 0xff).toString(16).padStart(2, '0');
        const y = ((smp?.Y ?? 0) & 0xff).toString(16).padStart(2, '0');
        parts.push(`SMP PC=${pc} PSW=${psw} A=${a} X=${x} Y=${y}`);
      } catch {}
    }
    if (args.traceMix && dsp) {
      try {
        const regs: Uint8Array | undefined = dsp['regs'];
        const u8 = (x: number) => (x & 0xff);
        const s8 = (x: number) => ((x << 24) >> 24);
        const r = (a: number) => u8(regs![a & 0x7f]);
        const kon = r(0x4c);
        const kof = r(0x5c);
        const flg = r(0x6c);
        const mvl = s8(r(0x0c));
        const mvr = s8(r(0x1c));
        parts.push(`DSP KON=${kon.toString(16)} KOF=${kof.toString(16)} FLG=${flg.toString(16)} MVL=${mvl} MVR=${mvr}`);
        const voiceSumm: string[] = [];
        for (let v = 0; v < 8; v++) {
          const base = v << 4;
          const vl = s8(r(base + 0x00));
          const vr = s8(r(base + 0x01));
          const pitch = ((r(base + 0x03) & 0x3f) << 8) | r(base + 0x02);
          const srcn = r(base + 0x04);
          voiceSumm.push(`V${v}:VL=${vl} VR=${vr} P=${pitch} SRC=${srcn}`);
        }
        parts.push(voiceSumm.join(" | "));
      } catch {}
    }
    // eslint-disable-next-line no-console
    console.log(parts.join("  "));
  };

  const traceEveryFrames = args.traceMs > 0 ? Math.max(1, Math.round((args.traceMs / 1000) * args.rate)) : 0;
  const timersEveryFrames = args.traceTimersMs > 0 ? Math.max(1, Math.round((args.traceTimersMs / 1000) * args.rate)) : 0;

  // Preroll to allow the SPC to initialize its player before capture
  const prerollFrames = Math.max(0, Math.round((args.prerollMs / 1000) * args.rate));
  // Track KON/KOF changes
  let lastKon = 0, lastKof = 0;
  try { const regs: Uint8Array | undefined = dsp?.['regs']; if (regs) { lastKon = regs[0x4c]&0xff; lastKof = regs[0x5c]&0xff; } } catch {}

  for (let i = 0; i < prerollFrames; i++) {
    if (!args.freezeSmp) apu.step(cyclesPerSample);
    apu.mixSample(); // advance DSP state
    if (args.traceKon && dsp) {
      try {
        const regs: Uint8Array | undefined = dsp['regs'];
        const kon = regs![0x4c] & 0xff; const kof = regs![0x5c] & 0xff;
        if (kon !== lastKon) { const tMs = (i/args.rate)*1000; console.log(`[KON][${tMs.toFixed(2)}ms] ${lastKon.toString(16)} -> ${kon.toString(16)}`); lastKon = kon; }
        if (kof !== lastKof) { const tMs = (i/args.rate)*1000; console.log(`[KOF][${tMs.toFixed(2)}ms] ${lastKof.toString(16)} -> ${kof.toString(16)}`); lastKof = kof; }
      } catch {}
    }
    if (traceEveryFrames > 0 && (i % traceEveryFrames) === 0) dumpTrace('preroll', i);
    if (timersEveryFrames > 0 && (i % timersEveryFrames) === 0) {
      try {
        const t0 = anyApu['t0'] as any; const t1 = anyApu['t1'] as any; const t2 = anyApu['t2'] as any;
        const t0c = t0?.readCounter?.() ?? -1; const t1c = t1?.readCounter?.() ?? -1; const t2c = t2?.readCounter?.() ?? -1;
        const tMs = (i/args.rate)*1000;
        console.log(`[TIMERS][${tMs.toFixed(2)}ms] cnt t0=${t0c} t1=${t1c} t2=${t2c}`);
      } catch {}
    }
  }

  let maxAbs = 0;
  let sumSq = 0;

  for (let i = 0; i < totalFrames; i++) {
    if (!args.freezeSmp) apu.step(cyclesPerSample);
    const [l, r] = apu.mixSample();
    if (args.traceKon && dsp) {
      try {
        const regs: Uint8Array | undefined = dsp['regs'];
        const kon = regs![0x4c] & 0xff; const kof = regs![0x5c] & 0xff;
        if (kon !== lastKon) { const tMs = (i/args.rate)*1000; console.log(`[KON][${tMs.toFixed(2)}ms] ${lastKon.toString(16)} -> ${kon.toString(16)}`); lastKon = kon; }
        if (kof !== lastKof) { const tMs = (i/args.rate)*1000; console.log(`[KOF][${tMs.toFixed(2)}ms] ${lastKof.toString(16)} -> ${kof.toString(16)}`); lastKof = kof; }
      } catch {}
    }
    if (traceEveryFrames > 0 && (i % traceEveryFrames) === 0) dumpTrace('render', i);
    if (timersEveryFrames > 0 && (i % timersEveryFrames) === 0) {
      try {
        const t0 = anyApu['t0'] as any; const t1 = anyApu['t1'] as any; const t2 = anyApu['t2'] as any;
        const t0c = t0?.readCounter?.() ?? -1; const t1c = t1?.readCounter?.() ?? -1; const t2c = t2?.readCounter?.() ?? -1;
        const tMs = (i/args.rate)*1000;
        console.log(`[TIMERS][${tMs.toFixed(2)}ms] cnt t0=${t0c} t1=${t1c} t2=${t2c}`);
      } catch {}
    }
    if (args.channels === 2) {
      pcm[i * 2 + 0] = l;
      pcm[i * 2 + 1] = r;
      const ml = Math.abs(l | 0), mr = Math.abs(r | 0);
      if (ml > maxAbs) maxAbs = ml;
      if (mr > maxAbs) maxAbs = mr;
      sumSq += l * l + r * r;
    } else {
      // mono: average
      const m = ((l + r) / 2) | 0;
      pcm[i] = m;
      const ma = Math.abs(m | 0);
      if (ma > maxAbs) maxAbs = ma;
      sumSq += m * m;
    }
  }

  const frames = totalFrames;
  const chans = args.channels;
  const rms = Math.sqrt(sumSq / Math.max(1, totalSamples));
  const peakNorm = maxAbs / 32767;
  const rmsNorm = rms / 32768;

  // Duration-based activity analysis to catch "single click" cases
  // Threshold is the greater of an absolute floor (~0.2% FS) and 5% of peak
  const absFloor = Math.floor(0.002 * 32768); // ~65
  const relThresh = Math.floor(maxAbs * 0.05);
  const activityThresh = Math.max(8, absFloor, relThresh);
  let activeFrames = 0;
  let longestRun = 0;
  let run = 0;
  for (let i = 0; i < frames; i++) {
    const idx = i * chans;
    const l = pcm[idx] | 0;
    const r = chans === 2 ? (pcm[idx + 1] | 0) : l;
    const mag = Math.max(Math.abs(l), Math.abs(r));
    const active = mag >= activityThresh;
    if (active) { activeFrames++; run++; if (run > longestRun) longestRun = run; }
    else { run = 0; }
  }
  const activeFrac = frames > 0 ? activeFrames / frames : 0;
  const longestMs = frames > 0 ? (longestRun / args.rate) * 1000 : 0;

  const tooQuiet = (maxAbs === 0 || peakNorm < 0.004);
  const tooShort = longestMs < 50; // require >=50ms of contiguous activity
  const tooSparse = activeFrac < 0.05; // require >=5% of frames to be active

  if (!args.allowSilence && (tooQuiet || tooShort || tooSparse)) {
    // Gather minimal SMP/DSP state for debugging
    const anyApu: any = apu as any;
    const smp: any = anyApu['smp'];
    const dsp: any = anyApu['dsp'];
    const regs: Uint8Array | undefined = dsp?.['regs'];
    let dbg = 'Detected no sustained audio.\n';
    // If mix trace was enabled, include first couple frames
    if (args.traceMix) {
      try {
        const frames: any[] = (apu as any).getMixTrace?.() || [];
        dbg += `[mixTrace frames=${frames.length} (up to 4 shown)]\n`;
        for (let i = 0; i < Math.min(frames.length, 4); i++) {
          dbg += ` mix[${i}] ${JSON.stringify(frames[i])}\n`;
        }
      } catch {}
    }
    // Dump last ~64 instructions from SMP ring if available
    try {
      const ring: { pc:number, op:number }[] = smp?.getInstrRing?.() ?? [];
      if (ring.length > 0) {
        const start = Math.max(0, ring.length - 64);
        dbg += 'SMP last instructions (pc:op):\n';
        for (let i = start; i < ring.length; i++) {
          const it = ring[i];
          if (!it) continue;
          dbg += ` ${it.pc.toString(16).padStart(4,'0')}:${it.op.toString(16).padStart(2,'0')}`;
          if (((i - start + 1) % 8) === 0) dbg += '\n';
        }
        dbg += '\n';
      }
    } catch {}
    dbg += `peakNorm=${peakNorm.toFixed(6)} rmsNorm=${rmsNorm.toFixed(6)} activeFrac=${activeFrac.toFixed(4)} longestMs=${longestMs.toFixed(1)} thresh=${activityThresh} prerollMs=${args.prerollMs} cyclesPerSample=${cyclesPerSample}\n`;
    // Include decode trace snapshot if available
    try {
      const dec: any[] = (apu as any)['dsp']?.getDecodeTrace?.() || [];
      if (dec.length > 0) {
        const nonZero = dec.filter((e:any)=>e && e.evt==='s' && e.s!==0).length;
        // Group hdr events by address
        const hdrs = dec.filter((e:any)=>e && e.evt==='hdr');
        const addrCounts: Record<string, number> = {};
        for (const h of hdrs) { const k = (h.addr|0).toString(16); addrCounts[k] = (addrCounts[k]||0)+1; }
        dbg += `decodeTrace(${dec.length}) s_nonzero=${nonZero} hdr_counts=${JSON.stringify(addrCounts)} head=${JSON.stringify(dec.slice(0, 12))} tail=${JSON.stringify(dec.slice(Math.max(0, dec.length-6)))}\n`;
      }
    } catch {}
    if (regs) {
      const s8 = (x: number) => ((x << 24) >> 24);
      const u8 = (x: number) => (x & 0xff);
      const r = (a: number) => u8(regs[a & 0x7f]);
      dbg += `DSP FLG=${r(0x6c).toString(16)} MVL=${s8(r(0x0c))} MVR=${s8(r(0x1c))} EVL=${s8(r(0x2c))} EVR=${s8(r(0x3c))} EON=${r(0x4d).toString(16)} EDL=${r(0x7d)&0x0f} ESA=${r(0x6d)} DIR=${r(0x5d)}\n`;
      for (let v = 0; v < 8; v++) {
        const base = v << 4;
        const vl = s8(r(base + 0x00));
        const vr = s8(r(base + 0x01));
        const pitch = ((r(base + 0x03) & 0x3f) << 8) | r(base + 0x02);
        const srcn = r(base + 0x04);
        const adsr1 = r(base + 0x05);
        const adsr2 = r(base + 0x06);
        const gain = r(base + 0x07);
        dbg += `V${v}: SRCN=${srcn} PITCH=${pitch} VL=${vl} VR=${vr} ADSR1=${adsr1.toString(16)} ADSR2=${adsr2.toString(16)} GAIN=${gain.toString(16)}\n`;
      }
    }
    throw new Error(dbg);
  }

  // If mix trace was enabled, dump a compact snapshot of the first few frames
  if (args.traceMix) {
    try {
      const frames: any[] = (apu as any).getMixTrace?.() || [];
      // eslint-disable-next-line no-console
      console.log(`[TRACE][mix] captured ${frames.length} frames (showing up to 8):`);
      for (let i = 0; i < Math.min(frames.length, 8); i++) {
        // eslint-disable-next-line no-console
        console.log(`[TRACE][mix][${i}]`, frames[i]);
      }
      try { (apu as any).endMixTrace?.(); } catch {}
    } catch {}
  }

  const wav = writeWavPCM16LE(pcm, args.rate, args.channels);
  const outAbs = path.resolve(args.out);
  fs.writeFileSync(outAbs, wav);
  console.log(`Wrote ${args.seconds}s WAV to ${outAbs} at ${args.rate} Hz (${args.channels} ch).`);
  // Optional: dump DSP I/O ring tail
  if (args.traceDspIo > 0) {
    try {
      const ring: any[] = (apu as any).getDspIoRing?.() || [];
      const n = Math.min(ring.length, args.traceDspIo|0);
      console.log(`[DSPIO] last ${n}/${ring.length}`);
      for (let i = ring.length - n; i < ring.length; i++) {
        const it = ring[i]; if (!it) continue;
        console.log(`[DSPIO] ${it.kind} ${it.addr.toString(16).padStart(4,'0')} v=${it.value.toString(16).padStart(2,'0')} dsp=${it.dspAddr.toString(16).padStart(2,'0')} pc=${it.pc.toString(16).padStart(4,'0')}`);
      }
    } catch {}
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

