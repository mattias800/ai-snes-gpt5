#!/usr/bin/env tsx
import * as fs from 'fs';

function readWavPCM16LE(path: string): {samples:Int16Array, sampleRate:number, channels:number} {
  const buf = fs.readFileSync(path);
  if (buf.toString('ascii',0,4) !== 'RIFF' || buf.toString('ascii',8,12) !== 'WAVE') throw new Error('Not a WAV');
  let o = 12;
  let fmtOffset = -1, dataOffset = -1, dataSize = 0;
  while (o + 8 <= buf.length) {
    const id = buf.toString('ascii', o, o+4); o += 4;
    const size = buf.readUInt32LE(o); o += 4;
    if (id === 'fmt ') fmtOffset = o;
    if (id === 'data') { dataOffset = o; dataSize = size; }
    o += size;
  }
  if (fmtOffset < 0 || dataOffset < 0) throw new Error('Bad WAV');
  const audioFormat = buf.readUInt16LE(fmtOffset + 0);
  const channels = buf.readUInt16LE(fmtOffset + 2);
  const sampleRate = buf.readUInt32LE(fmtOffset + 4);
  const bitsPerSample = buf.readUInt16LE(fmtOffset + 14);
  if (audioFormat !== 1 || bitsPerSample !== 16) throw new Error('Expected PCM16');
  const samples = new Int16Array(dataSize/2);
  for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(dataOffset + i*2);
  return {samples, sampleRate, channels};
}

function autocorrDominantHz(samples: Int16Array, sampleRate: number, channels: number): {hz:number, period:number} {
  // Use mono mix
  const n = Math.min(samples.length, sampleRate * channels * 2); // up to 2s
  const mono = new Float32Array(Math.floor(n / channels));
  for (let i = 0, j = 0; j < mono.length; j++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += samples[i++];
    mono[j] = s / channels;
  }
  // Remove DC
  let mean = 0;
  for (let i = 0; i < mono.length; i++) mean += mono[i];
  mean /= mono.length;
  for (let i = 0; i < mono.length; i++) mono[i] -= mean;
  // Autocorrelation over a window looking for 60 Hz..8 kHz
  const minHz = 60, maxHz = 8000;
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.ceil(sampleRate / minHz);
  let bestLag = -1, bestVal = -Infinity;
  const wnd = Math.min(mono.length, sampleRate); // up to 1s window
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < wnd; i++) acc += mono[i] * mono[i + lag];
    if (acc > bestVal) { bestVal = acc; bestLag = lag; }
  }
  const hz = bestLag > 0 ? sampleRate / bestLag : 0;
  return { hz, period: bestLag };
}

function main() {
  const p = process.argv[2];
  if (!p) throw new Error('Usage: analyze_wav <wav_path>');
  const {samples, sampleRate, channels} = readWavPCM16LE(p);
  const {hz, period} = autocorrDominantHz(samples, sampleRate, channels);
  console.log(JSON.stringify({ sampleRate, channels, hz: Math.round(hz*10)/10, period }));
}

main();

