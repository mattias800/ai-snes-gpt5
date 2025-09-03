#!/usr/bin/env tsx
import * as fs from 'fs';
import { APUDevice } from './src/apu/apu';
import { loadSpcIntoApu } from './src/apu/spc_loader';

function createWAV(samples: number[], sampleRate: number): Buffer {
  const numSamples = samples.length / 2;
  const header = Buffer.alloc(44);
  
  // RIFF header
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + numSamples * 4, 4);
  header.write('WAVE', 8);
  
  // fmt chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(2, 22); // Stereo
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  
  // data chunk
  header.write('data', 36);
  header.writeUInt32LE(numSamples * 4, 40);
  
  // Write samples
  const data = Buffer.alloc(numSamples * 4);
  for (let i = 0; i < samples.length; i++) {
    const val = Math.max(-32768, Math.min(32767, Math.round(samples[i])));
    data.writeInt16LE(val, i * 2);
  }
  
  return Buffer.concat([header, data]);
}

function renderSPC(inputFile: string, outputFile: string, seconds: number = 30, gain: number = 10) {
  const sampleRate = 32000;
  
  console.log(`Loading ${inputFile}...`);
  const spcData = fs.readFileSync(inputFile);
  
  // Create APU and load SPC
  const apu = new APUDevice();
  
  // Enable timer IRQ injection to help music drivers that rely on timer interrupts
  apu.setTimerIrqInjection(true);
  
  loadSpcIntoApu(apu, spcData);
  
  const anyApu: any = apu;
  const dsp = anyApu.dsp;
  dsp.setMixGain(gain);
  
  // Check timer configuration
  const f1 = apu.aram[0xF1];
  const timerEnabled = (f1 & 0x07) !== 0;
  console.log('Timer config: F1=0x' + f1.toString(16) + ' (timers ' + (timerEnabled ? 'enabled' : 'disabled') + ')');
  
  // Check initial state
  console.log('Active voices:');
  for(let i = 0; i < 8; i++) {
    const v = dsp.voices[i];
    if(v.active) {
      console.log(`  V${i}: srcn=${v.srcn}, volL=${v.volL}, volR=${v.volR}`);
    }
  }
  
  // Pre-roll to let envelopes develop
  const prerollSamples = Math.floor(sampleRate * 0.2); // 200ms pre-roll
  console.log(`Pre-rolling ${prerollSamples} samples...`);
  
  let konChanges = 0;
  let lastKon = 0x0f;
  
  for (let i = 0; i < prerollSamples; i++) {
    apu.step(32);
    dsp.mixSample(); // Discard pre-roll samples
    
    // Monitor KON changes during preroll
    if (i % 100 === 0) {
      dsp.writeAddr(0x4c);
      const kon = dsp.readData();
      if (kon !== lastKon) {
        konChanges++;
        lastKon = kon;
      }
    }
  }
  
  if (konChanges > 0) {
    console.log('Music driver is active! KON changed ' + konChanges + ' times during preroll');
  }
  
  // Main render
  const totalSamples = Math.floor(seconds * sampleRate);
  const audioData: number[] = [];
  let peakL = 0, peakR = 0;
  
  console.log(`Rendering ${seconds} seconds (${totalSamples} samples)...`);
  const progressInterval = Math.floor(totalSamples / 10);
  
  for (let i = 0; i < totalSamples; i++) {
    // Step APU (32 SMP cycles per sample at ~32kHz)
    apu.step(32);
    
    // Mix audio
    const [l, r] = dsp.mixSample();
    audioData.push(l, r);
    
    // Track peak
    peakL = Math.max(peakL, Math.abs(l));
    peakR = Math.max(peakR, Math.abs(r));
    
    // Progress indicator
    if (i % progressInterval === 0 && i > 0) {
      const percent = Math.round((i / totalSamples) * 100);
      process.stdout.write(`${percent}% `);
      
      // Check for music activity
      if (i === progressInterval) {
        dsp.writeAddr(0x4c);
        const currentKon = dsp.readData();
        if (currentKon !== lastKon) {
          process.stdout.write('[ACTIVE] ');
        }
      }
    }
  }
  console.log('100%');
  
  // Report stats
  const peakDb = (val: number) => 20 * Math.log10(val / 32768);
  console.log(`\nPeak amplitude: L=${peakL} (${peakDb(peakL).toFixed(1)}dB), R=${peakR} (${peakDb(peakR).toFixed(1)}dB)`);
  
  // Create and save WAV
  const wav = createWAV(audioData, sampleRate);
  fs.writeFileSync(outputFile, wav);
  console.log(`Saved ${outputFile} (${(wav.length / 1024).toFixed(1)} KB)`);
}

// Main
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: render_spc_fixed.ts <input.spc> <output.wav> [seconds] [gain]');
  console.log('  seconds: Duration in seconds (default: 30)');
  console.log('  gain: Mix gain multiplier (default: 10)');
  process.exit(1);
}

const [input, output] = args;
const seconds = parseFloat(args[2]) || 30;
const gain = parseFloat(args[3]) || 10;

if (!fs.existsSync(input)) {
  console.error(`Input file not found: ${input}`);
  process.exit(1);
}

renderSPC(input, output, seconds, gain);
