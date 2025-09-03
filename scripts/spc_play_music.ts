#!/usr/bin/env npx tsx
// Play SPC files with proper music engine support

import * as fs from 'fs';
import * as path from 'path';
import { SPC700 } from '../src/apu/spc700';

interface Args {
  inFile: string;
  outFile: string;
  seconds: number;
  gain: number;
  rate: number;
  prerollMs: number;
  allowSilence: boolean;
  traceMix: boolean;
  traceDecoder: number;
  startSong: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = {
    inFile: '',
    outFile: '',
    seconds: 10,
    gain: 1,
    rate: 32000,
    prerollMs: 200,
    allowSilence: false,
    traceMix: false,
    traceDecoder: 0,
    startSong: 0
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--in=')) result.inFile = arg.slice(5);
    else if (arg.startsWith('--out=')) result.outFile = arg.slice(6);
    else if (arg.startsWith('--seconds=')) result.seconds = parseFloat(arg.slice(10));
    else if (arg.startsWith('--gain=')) result.gain = parseFloat(arg.slice(7));
    else if (arg.startsWith('--rate=')) result.rate = parseInt(arg.slice(7));
    else if (arg.startsWith('--preroll-ms=')) result.prerollMs = parseInt(arg.slice(13));
    else if (arg.startsWith('--allow-silence=')) result.allowSilence = arg.slice(16) === '1';
    else if (arg.startsWith('--trace-mix=')) result.traceMix = arg.slice(12) === '1';
    else if (arg.startsWith('--trace-decode=')) result.traceDecoder = parseInt(arg.slice(15));
    else if (arg.startsWith('--start-song=')) result.startSong = parseInt(arg.slice(13));
  }

  if (!result.inFile || !result.outFile) {
    console.error('Usage: spc_play_music.ts --in=input.spc --out=output.wav [options]');
    console.error('Options:');
    console.error('  --seconds=N        Duration in seconds (default: 10)');
    console.error('  --gain=N           Gain factor (default: 1)');
    console.error('  --rate=N           Sample rate (default: 32000)');
    console.error('  --preroll-ms=N     Preroll milliseconds (default: 200)');
    console.error('  --allow-silence=1  Allow silent output');
    console.error('  --trace-mix=1      Trace mixing');
    console.error('  --trace-decode=N   Trace first N decode events');
    console.error('  --start-song=N     Send song start command (0=no, N=song number)');
    process.exit(1);
  }

  return result;
}

// Common Nintendo music engine commands (N-SPC and similar)
function sendMusicCommand(apu: SPC700, cmd: number, data: number = 0) {
  // Common protocol: write command to $F4, data to $F5-F7
  // Wait for acknowledgment by reading back
  const aram = apu.getAram();
  
  // Simulate main CPU writing to ports
  // $2140-2143 on SNES side = $F4-F7 on SPC side
  aram[0xf4] = cmd & 0xff;
  aram[0xf5] = data & 0xff;
  aram[0xf6] = 0;
  aram[0xf7] = 0;
  
  // Step SMP to process command
  for (let i = 0; i < 1000; i++) {
    apu.stepCycles(64);
    // Check if SMP acknowledged (common pattern: it echoes back or clears)
    if (aram[0xf4] !== cmd) break;
  }
}

function startSong(apu: SPC700, songNum: number) {
  console.log(`[MUSIC] Attempting to start song ${songNum}`);
  
  // Common music engine commands across Nintendo games:
  // $01-$7F = play song
  // $80 = stop
  // $81 = pause
  // $F0-FF = system commands
  
  // Try multiple common protocols
  const aram = apu.getAram();
  
  // Protocol 1: Direct song number to $F4
  aram[0xf4] = songNum & 0xff;
  apu.stepCycles(1000);
  
  // Protocol 2: Play command ($01) with song number
  aram[0xf4] = 0x01;
  aram[0xf5] = songNum & 0xff;
  apu.stepCycles(1000);
  
  // Protocol 3: Nintendo standard (used by many games)
  // Clear ports first
  aram[0xf4] = 0;
  aram[0xf5] = 0;
  aram[0xf6] = 0;
  aram[0xf7] = 0;
  apu.stepCycles(100);
  
  // Send play command
  aram[0xf4] = songNum & 0xff;
  aram[0xf5] = 0x00;
  apu.stepCycles(1000);
  
  // Check if any voices got keyed on
  const dsp = apu.getDSP();
  const kon = dsp.readData();
  if (kon !== 0) {
    console.log(`[MUSIC] Voices keyed on: 0x${kon.toString(16)}`);
  }
}

function createWavHeader(numSamples: number, sampleRate: number, numChannels: number): Buffer {
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const fileSize = 36 + dataSize;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(fileSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  
  return header;
}

async function main() {
  const args = parseArgs();
  
  // Load SPC file
  const spcData = fs.readFileSync(args.inFile);
  
  // Create APU and load SPC
  const apu = new SPC700();
  apu.loadSPC(spcData);
  
  // Configure DSP
  const dsp = apu.getDSP();
  dsp.setMixGain(args.gain);
  
  if (args.traceMix) {
    dsp.beginMixTrace(64);
  }
  if (args.traceDecoder > 0) {
    dsp.setDecodeTrace(args.traceDecoder);
  }
  
  // Check current state
  console.log('[MUSIC] Initial DSP state:');
  const aram = apu.getAram();
  dsp.writeAddr(0x4c); // KON register
  const initialKon = dsp.readData();
  console.log(`  KON: 0x${initialKon.toString(16)}`);
  console.log(`  Port $F4: 0x${aram[0xf4].toString(16)}`);
  console.log(`  Port $F5: 0x${aram[0xf5].toString(16)}`);
  
  // Try to start music if requested
  if (args.startSong > 0) {
    startSong(apu, args.startSong);
  }
  
  // Run preroll
  const prerollSamples = Math.floor((args.prerollMs * args.rate) / 1000);
  const cyclesPerSample = 32;
  
  for (let i = 0; i < prerollSamples; i++) {
    apu.stepCycles(cyclesPerSample);
    dsp.mixSample(); // discard
  }
  
  // Capture audio
  const totalSamples = Math.floor(args.seconds * args.rate);
  const audioData: number[] = [];
  
  let peakL = 0, peakR = 0;
  let hasAudio = false;
  
  for (let i = 0; i < totalSamples; i++) {
    apu.stepCycles(cyclesPerSample);
    const [l, r] = dsp.mixSample();
    
    audioData.push(l, r);
    
    const absL = Math.abs(l);
    const absR = Math.abs(r);
    if (absL > peakL) peakL = absL;
    if (absR > peakR) peakR = absR;
    
    if (absL > 100 || absR > 100) hasAudio = true;
    
    // Periodically try to restart music if it stops
    if (i > 0 && i % args.rate === 0 && args.startSong > 0) {
      dsp.writeAddr(0x4c);
      const kon = dsp.readData();
      if (kon === 0) {
        console.log(`[MUSIC] No voices active at ${i/args.rate}s, restarting...`);
        startSong(apu, args.startSong);
      }
    }
  }
  
  // Check if we got audio
  const peakNorm = Math.max(peakL, peakR) / 32768;
  console.log(`[MUSIC] Peak amplitude: ${(peakNorm * 100).toFixed(1)}%`);
  
  if (!hasAudio && !args.allowSilence) {
    console.error('Error: No audio detected. Use --allow-silence=1 to override.');
    
    // Print final state
    console.log('\nFinal DSP state:');
    for (let v = 0; v < 8; v++) {
      const base = v << 4;
      dsp.writeAddr(base + 4); const srcn = dsp.readData();
      dsp.writeAddr(base + 2); const pitchL = dsp.readData();
      dsp.writeAddr(base + 3); const pitchH = dsp.readData();
      const pitch = ((pitchH & 0x3f) << 8) | pitchL;
      dsp.writeAddr(base + 0); const volL = dsp.readData();
      dsp.writeAddr(base + 1); const volR = dsp.readData();
      
      if (srcn !== 0 || pitch !== 0) {
        console.log(`V${v}: SRCN=${srcn} PITCH=${pitch} VL=${volL} VR=${volR}`);
      }
    }
    
    process.exit(1);
  }
  
  // Write WAV file
  const header = createWavHeader(totalSamples, args.rate, 2);
  const samples = Buffer.alloc(totalSamples * 4);
  
  for (let i = 0; i < audioData.length; i++) {
    const val = Math.max(-32768, Math.min(32767, Math.round(audioData[i])));
    samples.writeInt16LE(val, i * 2);
  }
  
  const outPath = path.resolve(args.outFile);
  fs.writeFileSync(outPath, Buffer.concat([header, samples]));
  
  console.log(`Wrote ${args.seconds}s WAV to ${outPath} at ${args.rate} Hz (2 ch).`);
  
  // Print trace if enabled
  if (args.traceMix) {
    const trace = dsp.getMixTrace();
    if (trace.length > 0) {
      console.log('[TRACE] First few mix frames:');
      for (let i = 0; i < Math.min(5, trace.length); i++) {
        console.log(`[${i}]`, JSON.stringify(trace[i], null, 2));
      }
    }
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
