#!/usr/bin/env tsx

import * as fs from 'fs';

function readWav(path: string) {
  const b = fs.readFileSync(path);
  const riff = b.toString('ascii', 0, 4);
  const wave = b.toString('ascii', 8, 12);
  if (riff !== 'RIFF' || wave !== 'WAVE') throw new Error('Not a RIFF/WAVE file');

  let o = 12;
  let fmtOffset = -1, fmtSize = 0;
  let dataOffset = -1, dataSize = 0;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const sz = b.readUInt32LE(o + 4);
    if (id === 'fmt ') { fmtOffset = o + 8; fmtSize = sz; }
    if (id === 'data') { dataOffset = o + 8; dataSize = sz; }
    o += 8 + sz;
  }
  if (fmtOffset < 0 || dataOffset < 0) throw new Error('Missing fmt/data chunk');

  const audioFormat = b.readUInt16LE(fmtOffset + 0);
  const channels = b.readUInt16LE(fmtOffset + 2);
  const sampleRate = b.readUInt32LE(fmtOffset + 4);
  const bitsPerSample = b.readUInt16LE(fmtOffset + 14);
  if (audioFormat !== 1) throw new Error('Only PCM supported');
  if (bitsPerSample !== 16) throw new Error('Only 16-bit PCM supported');

  const nSamples = dataSize / 2;
  const nFrames = Math.floor(nSamples / channels);

  let sumL = 0, sumR = 0, peakL = 0, peakR = 0;
  for (let i = 0; i < nFrames; i++) {
    const off = dataOffset + i * channels * 2;
    const l = b.readInt16LE(off);
    const r = channels >= 2 ? b.readInt16LE(off + 2) : l;
    sumL += l * l;
    sumR += r * r;
    const al = Math.abs(l), ar = Math.abs(r);
    if (al > peakL) peakL = al;
    if (ar > peakR) peakR = ar;
  }
  const rmsL = Math.sqrt(sumL / Math.max(1, nFrames)) / 32768;
  const rmsR = Math.sqrt(sumR / Math.max(1, nFrames)) / 32768;
  const peakLn = peakL / 32768;
  const peakRn = peakR / 32768;

  // Build a tiny ASCII snippet of the first ~60 samples (left channel)
  const cols = 32;
  const steps = 60;
  const step = Math.max(1, Math.floor(nFrames / steps));
  let snippet = '';
  let count = 0;
  for (let i = 0; i < Math.min(nFrames, step * steps); i += step) {
    const off = dataOffset + i * channels * 2;
    const l = b.readInt16LE(off) / 32768;
    const v = Math.max(-1, Math.min(1, l));
    const half = Math.round(((v + 1) / 2) * cols);
    snippet += '[' + '#'.repeat(half) + ' '.repeat(cols - half) + ']';
    count++;
    if (count % 10 === 0) snippet += '\n';
  }

  return {
    sampleRate, channels, seconds: nFrames / sampleRate, frames: nFrames,
    peakL: +peakLn.toFixed(6), peakR: +peakRn.toFixed(6),
    rmsL: +rmsL.toFixed(6), rmsR: +rmsR.toFixed(6),
    snippet
  };
}

const wavPath = process.argv[2] || 'yoshi_render.wav';
try {
  const stats = readWav(wavPath);
  console.log('STAT', JSON.stringify(stats));
  console.log('SNIPPET\n' + stats.snippet);
} catch (e: any) {
  console.log('ERR', e?.message || String(e));
  process.exit(1);
}

