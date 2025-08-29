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
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Invalid --seconds');
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid --rate');
  if (channels !== 1 && channels !== 2) throw new Error('Invalid --channels (1 or 2)');
  if (!Number.isFinite(gain) || gain <= 0) throw new Error('Invalid --gain');
  if (!Number.isFinite(prerollMs) || prerollMs < 0) throw new Error('Invalid --preroll-ms');
  return { in: inPath, out: outPath, seconds, rate, channels: channels as 1 | 2, allowSilence, gain, prerollMs };
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
  loadSpcIntoApu(apu, spcBuf);

  const totalFrames = Math.floor(args.seconds * args.rate);
  const totalSamples = totalFrames * args.channels;
  const pcm = new Int16Array(totalSamples);

  // Time-based stepping: cycles per output sample derived from SMP clock
  const cyclesPerSample = Math.max(1, Math.round(SMP_CLOCK_HZ / args.rate));

  // Preroll to allow the SPC to initialize its player before capture
  const prerollFrames = Math.max(0, Math.round((args.prerollMs / 1000) * args.rate));
  for (let i = 0; i < prerollFrames; i++) {
    apu.step(cyclesPerSample);
    apu.mixSample(); // advance DSP state
  }

  let maxAbs = 0;
  let sumSq = 0;

  for (let i = 0; i < totalFrames; i++) {
    apu.step(cyclesPerSample);
    const [l, r] = apu.mixSample();
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
    // Gather minimal DSP state for debugging
    const anyApu: any = apu as any;
    const dsp: any = anyApu['dsp'];
    const regs: Uint8Array | undefined = dsp?.['regs'];
    let dbg = 'Detected no sustained audio.\n';
    dbg += `peakNorm=${peakNorm.toFixed(6)} rmsNorm=${rmsNorm.toFixed(6)} activeFrac=${activeFrac.toFixed(4)} longestMs=${longestMs.toFixed(1)} thresh=${activityThresh} prerollMs=${args.prerollMs} cyclesPerSample=${cyclesPerSample}\n`;
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

  const wav = writeWavPCM16LE(pcm, args.rate, args.channels);
  const outAbs = path.resolve(args.out);
  fs.writeFileSync(outAbs, wav);
  console.log(`Wrote ${args.seconds}s WAV to ${outAbs} at ${args.rate} Hz (${args.channels} ch).`);
}

main().catch((e) => { console.error(e); process.exit(1); });

