#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { APUDevice } from '../src/apu/apu';
import { loadSpcIntoApu } from '../src/apu/spc_loader';

interface CliArgs {
  in: string;
  out: string;
  seconds: number;
  rate: number;
  channels: 1 | 2;
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
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Invalid --seconds');
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid --rate');
  if (channels !== 1 && channels !== 2) throw new Error('Invalid --channels (1 or 2)');
  return { in: inPath, out: outPath, seconds, rate, channels: channels as 1 | 2 };
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
  loadSpcIntoApu(apu, spcBuf);

  const totalFrames = Math.floor(args.seconds * args.rate);
  const totalSamples = totalFrames * args.channels;
  const pcm = new Int16Array(totalSamples);

  for (let i = 0; i < totalFrames; i++) {
    // Step SMP ~32 cycles per 32kHz output sample (approx ratio)
    apu.step(32);
    const [l, r] = apu.mixSample();
    if (args.channels === 2) {
      pcm[i * 2 + 0] = l;
      pcm[i * 2 + 1] = r;
    } else {
      // mono: average
      const m = ((l + r) / 2) | 0;
      pcm[i] = m;
    }
  }

  const wav = writeWavPCM16LE(pcm, args.rate, args.channels);
  const outAbs = path.resolve(args.out);
  fs.writeFileSync(outAbs, wav);
  console.log(`Wrote ${args.seconds}s WAV to ${outAbs} at ${args.rate} Hz (${args.channels} ch).`);
}

main().catch((e) => { console.error(e); process.exit(1); });

