#!/usr/bin/env npx tsx
// Enhanced SPC renderer that acts as the "main CPU" to drive music playback

import * as fs from 'fs';
import * as path from 'path';
import { APUDevice } from '../src/apu/apu';
import { loadSpcIntoApu } from '../src/apu/spc_loader';

interface RenderOptions {
  inFile: string;
  outFile: string;
  seconds: number;
  sampleRate: number;
  gain: number;
  prerollMs: number;
  allowSilence: boolean;
  traceMix: boolean;
  traceDecoder: number;
  autoPatch: boolean;
  forceTimers: boolean;
  communicationMode: 'auto' | 'nspc' | 'rare' | 'none';
}

class SPCRenderer {
  private apu: APUDevice;
  private options: RenderOptions;
  private cyclesPerSample: number;
  private timerCycles: number = 0;
  private communicationState: number = 0;
  private frameCount: number = 0;
  private lastKonValue: number = 0;

  constructor(options: RenderOptions) {
    this.options = options;
    this.apu = new APUDevice();
    this.cyclesPerSample = 32; // ~32 SPC cycles per audio sample at 32kHz
  }

  load(spcData: Buffer): void {
    // Load the SPC snapshot
    loadSpcIntoApu(this.apu, spcData);

    // Configure DSP
    this.apu.dsp.setMixGain(this.options.gain);
    if (this.options.traceMix) {
      this.apu.dsp.beginMixTrace(64);
    }
    if (this.options.traceDecoder > 0) {
      this.apu.dsp.setDecodeTrace(this.options.traceDecoder);
    }
  }

  private patchWaitLoops(aram: Uint8Array): boolean {
    // Detect and patch common wait loops
    let patched = false;

    // Pattern 1: MOV A,$00F4 / CMP A,#val / BNE (waiting for port)
    for (let addr = 0; addr < 0xFF00; addr++) {
      if (aram[addr] === 0xE5 && aram[addr + 1] === 0xF4 && 
          aram[addr + 2] === 0x00 && aram[addr + 3] === 0x68 &&
          aram[addr + 5] === 0xD0) {
        const branchOffset = aram[addr + 6];
        const branchDest = addr + 7 + (branchOffset << 24 >> 24);
        if (branchDest <= addr && branchDest >= addr - 10) {
          console.log(`[PATCH] NOPing wait loop at $${addr.toString(16)}`);
          for (let i = 0; i < 7; i++) aram[addr + i] = 0x00;
          patched = true;
        }
      }
    }

    return patched;
  }

  private simulateCommunication(): void {
    // Simulate main CPU communication patterns based on the selected mode
    const aram = this.apu.aram;
    
    switch (this.options.communicationMode) {
      case 'nspc':
        // Nintendo SPC protocol - periodic acknowledgments
        if (this.frameCount % 60 === 0) {
          const currentF4 = aram[0xF4];
          // Echo back with increment (common handshake)
          aram[0xF4] = (currentF4 + 1) & 0xFF;
        }
        break;
        
      case 'rare':
        // Rare/David Wise protocol
        if (this.frameCount % 120 === 0) {
          aram[0xF4] = 0x00;
          aram[0xF5] = this.communicationState++ & 0xFF;
        }
        break;
        
      case 'auto':
        // Try to auto-detect and respond
        this.autoDetectCommunication();
        break;
    }
  }

  private autoDetectCommunication(): void {
    const aram = this.apu.aram;
    
    // Check if SMP wrote something to ports (indicating it wants communication)
    const f4 = aram[0xF4];
    const f5 = aram[0xF5];
    
    // Common pattern: SMP writes a value and waits for acknowledgment
    if (f4 !== 0 && this.communicationState !== f4) {
      // Acknowledge by incrementing
      this.communicationState = f4;
      aram[0xF4] = (f4 + 1) & 0xFF;
      console.log(`[COMM] Auto-ack: F4=${f4.toString(16)} -> ${((f4 + 1) & 0xFF).toString(16)}`);
    }
  }

  private forceTimerIRQ(): void {
    // Force timer interrupts to fire
    // This is a hack that makes the SMP think timers have expired
    const ctrl = this.apu.aram[0xF1];
    
    // Check which timers are enabled
    const t0en = (ctrl & 0x01) !== 0;
    const t1en = (ctrl & 0x02) !== 0; 
    const t2en = (ctrl & 0x04) !== 0;

    // Every N cycles, force an IRQ
    this.timerCycles += this.cyclesPerSample;
    const timerRate = 256; // Approximate timer rate
    
    if (this.timerCycles >= timerRate) {
      this.timerCycles = 0;
      
      // Check if IRQ vector is valid
      const irqLo = this.apu.aram[0xFFFE];
      const irqHi = this.apu.aram[0xFFFF];
      const irqVec = (irqHi << 8) | irqLo;
      
      if (irqVec !== 0xFFFF && irqVec !== 0x0000 && (t0en || t1en || t2en)) {
        // Valid IRQ handler exists, trigger it
        this.apu.smp.requestIRQ();
      } else {
        // No IRQ handler! Try to find and call music tick directly
        this.callMusicTickDirectly();
      }
      
      // Update timer counters for engines that poll them
      if (t0en) this.apu.aram[0xFD] = (this.apu.aram[0xFD] + 1) & 0xFF;
      if (t1en) this.apu.aram[0xFE] = (this.apu.aram[0xFE] + 1) & 0xFF;
      if (t2en) this.apu.aram[0xFF] = (this.apu.aram[0xFF] + 1) & 0xFF;
    }
  }

  private callMusicTickDirectly(): void {
    // Try to find and call the music tick routine directly
    // This is a hack for SPCs with no IRQ handler set up
    
    // Common music tick entry points in various engines
    const tickAddresses = [
      0x0500, // Common N-SPC location
      0x0800, // Alternative
      0x0400, // Some engines
      0x0C00, // Rare engine location
    ];
    
    for (const addr of tickAddresses) {
      // Check if there's code there (not FF or 00)
      const firstByte = this.apu.aram[addr];
      if (firstByte !== 0xFF && firstByte !== 0x00) {
        // Looks like code, try calling it
        // Save current PC
        const oldPC = this.apu.smp.PC;
        
        // Call the routine (simulate JSR)
        this.apu.smp.PC = addr;
        
        // Run for a limited number of cycles to avoid infinite loops
        let cycles = 0;
        while (cycles < 1000) {
          try {
            cycles += this.apu.smp.stepInstruction();
            // Check if we hit a RET (0x6F) or RETI (0x7F)
            const op = this.apu.aram[this.apu.smp.PC - 1];
            if (op === 0x6F || op === 0x7F) break;
          } catch (e) {
            // Hit unimplemented opcode or error, bail out
            break;
          }
        }
        
        // Restore PC if we didn't return naturally
        if (this.apu.smp.PC !== oldPC) {
          this.apu.smp.PC = oldPC;
        }
        
        // Check if any KON changed (indicates we found the right routine)
        this.apu.dsp.writeAddr(0x4C);
        const kon = this.apu.dsp.readData();
        if (kon !== this.lastKonValue) {
          console.log(`[MUSIC] Direct tick at $${addr.toString(16)} triggered KON change`);
          this.lastKonValue = kon;
          break;
        }
      }
    }
  }

  private detectAndStartMusic(): void {
    // Try to detect the music engine and send appropriate start commands
    const aram = this.apu.aram;
    
    // Check for common music engine signatures
    const signature = String.fromCharCode(...Array.from(aram.slice(0x200, 0x210)));
    
    if (signature.includes('N-SPC') || signature.includes('Nintendo')) {
      console.log('[MUSIC] N-SPC engine detected');
      // N-SPC start command
      aram[0xF4] = 0x01; // Play song 1
      aram[0xF5] = 0x00;
    } else {
      // Generic start attempts
      const startCommands = [
        { f4: 0x00, f5: 0x01 }, // Common play command
        { f4: 0x01, f5: 0x00 }, // Alternative
        { f4: 0xFF, f5: 0x01 }, // Some engines use FF as start
      ];
      
      for (const cmd of startCommands) {
        aram[0xF4] = cmd.f4;
        aram[0xF5] = cmd.f5;
        
        // Run a few cycles to see if it responds
        for (let i = 0; i < 100; i++) {
          this.apu.step(32);
        }
        
        // Check if any voices got keyed on
        this.apu.dsp.writeAddr(0x4C); // KON register
        const kon = this.apu.dsp.readData();
        if (kon !== 0) {
          console.log(`[MUSIC] Start command worked: F4=${cmd.f4.toString(16)} F5=${cmd.f5.toString(16)}, KON=${kon.toString(16)}`);
          break;
        }
      }
    }
  }

  render(): Buffer {
    const sampleRate = this.options.sampleRate;
    const seconds = this.options.seconds;
    const totalSamples = Math.floor(seconds * sampleRate);
    const prerollSamples = Math.floor((this.options.prerollMs * sampleRate) / 1000);
    
    // Auto-patch if requested
    if (this.options.autoPatch) {
      if (this.patchWaitLoops(this.apu.aram)) {
        console.log('[PATCH] Applied wait loop patches');
      }
    }

    // Try to start music
    this.detectAndStartMusic();
    
    // Preroll (let the engine initialize)
    console.log(`[RENDER] Preroll ${prerollSamples} samples...`);
    for (let i = 0; i < prerollSamples; i++) {
      this.apu.step(this.cyclesPerSample);
      
      if (this.options.forceTimers) {
        this.forceTimerIRQ();
      }
      
      this.simulateCommunication();
      this.apu.dsp.mixSample(); // Discard preroll audio
      this.frameCount++;
    }

    // Check initial state
    this.apu.dsp.writeAddr(0x4C);
    const initialKon = this.apu.dsp.readData();
    console.log(`[RENDER] After preroll: KON=${initialKon.toString(16).padStart(2, '0')}`);

    // Main rendering
    console.log(`[RENDER] Rendering ${totalSamples} samples...`);
    const audioData: number[] = [];
    let peakL = 0, peakR = 0;
    let hasAudio = false;
    let lastKon = initialKon;
    let konChanges = 0;

    for (let i = 0; i < totalSamples; i++) {
      // Step the APU
      this.apu.step(this.cyclesPerSample);
      
      // Force timer IRQs if enabled
      if (this.options.forceTimers) {
        this.forceTimerIRQ();
      }
      
      // Simulate CPU communication
      this.simulateCommunication();
      
      // Mix audio
      const [l, r] = this.apu.dsp.mixSample();
      audioData.push(l, r);
      
      // Track statistics
      const absL = Math.abs(l);
      const absR = Math.abs(r);
      if (absL > peakL) peakL = absL;
      if (absR > peakR) peakR = absR;
      if (absL > 100 || absR > 100) hasAudio = true;
      
      // Monitor KON changes (indicates music is progressing)
      if (i % sampleRate === 0) { // Check once per second
        this.apu.dsp.writeAddr(0x4C);
        const kon = this.apu.dsp.readData();
        if (kon !== lastKon) {
          konChanges++;
          console.log(`[RENDER] KON change at ${i/sampleRate}s: ${lastKon.toString(16)} -> ${kon.toString(16)}`);
          lastKon = kon;
        }
      }
      
      this.frameCount++;
    }

    // Report results
    const peakNorm = Math.max(peakL, peakR) / 32768;
    console.log(`[RENDER] Peak amplitude: ${(peakNorm * 100).toFixed(1)}%`);
    console.log(`[RENDER] KON changes: ${konChanges} (${konChanges > 0 ? 'music is progressing!' : 'static'})`);
    
    if (!hasAudio && !this.options.allowSilence) {
      throw new Error('No audio detected. Use --allow-silence to override.');
    }

    // Create WAV file
    return this.createWav(audioData, sampleRate);
  }

  private createWav(samples: number[], sampleRate: number): Buffer {
    const numSamples = samples.length / 2;
    const bytesPerSample = 2;
    const numChannels = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(16, 34); // 16-bit
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    const data = Buffer.alloc(dataSize);
    for (let i = 0; i < samples.length; i++) {
      const val = Math.max(-32768, Math.min(32767, Math.round(samples[i])));
      data.writeInt16LE(val, i * 2);
    }

    return Buffer.concat([header, data]);
  }
}

// Main CLI
function parseArgs(): RenderOptions {
  const args = process.argv.slice(2);
  const options: RenderOptions = {
    inFile: '',
    outFile: '',
    seconds: 10,
    sampleRate: 32000,
    gain: 1,
    prerollMs: 200,
    allowSilence: false,
    traceMix: false,
    traceDecoder: 0,
    autoPatch: true,
    forceTimers: true,
    communicationMode: 'auto'
  };

  for (const arg of args) {
    if (arg.startsWith('--in=')) options.inFile = arg.slice(5);
    else if (arg.startsWith('--out=')) options.outFile = arg.slice(6);
    else if (arg.startsWith('--seconds=')) options.seconds = parseFloat(arg.slice(10));
    else if (arg.startsWith('--rate=')) options.sampleRate = parseInt(arg.slice(7));
    else if (arg.startsWith('--gain=')) options.gain = parseFloat(arg.slice(7));
    else if (arg.startsWith('--preroll-ms=')) options.prerollMs = parseInt(arg.slice(13));
    else if (arg.startsWith('--allow-silence')) options.allowSilence = true;
    else if (arg.startsWith('--trace-mix')) options.traceMix = true;
    else if (arg.startsWith('--trace-decode=')) options.traceDecoder = parseInt(arg.slice(15));
    else if (arg.startsWith('--no-patch')) options.autoPatch = false;
    else if (arg.startsWith('--no-timers')) options.forceTimers = false;
    else if (arg.startsWith('--comm=')) {
      const mode = arg.slice(7);
      if (['auto', 'nspc', 'rare', 'none'].includes(mode)) {
        options.communicationMode = mode as any;
      }
    }
  }

  if (!options.inFile || !options.outFile) {
    console.error('Usage: spc_renderer.ts --in=input.spc --out=output.wav [options]');
    console.error('Options:');
    console.error('  --seconds=N        Duration (default: 10)');
    console.error('  --rate=N           Sample rate (default: 32000)');
    console.error('  --gain=N           Gain factor (default: 1)');
    console.error('  --preroll-ms=N     Preroll time (default: 200)');
    console.error('  --allow-silence    Allow silent output');
    console.error('  --trace-mix        Enable mix tracing');
    console.error('  --trace-decode=N   Trace N decode events');
    console.error('  --no-patch         Disable auto-patching');
    console.error('  --no-timers        Disable forced timer IRQs');
    console.error('  --comm=MODE        Communication mode (auto/nspc/rare/none)');
    process.exit(1);
  }

  return options;
}

async function main() {
  const options = parseArgs();
  
  console.log(`[RENDER] Loading ${options.inFile}...`);
  const spcData = fs.readFileSync(options.inFile);
  
  const renderer = new SPCRenderer(options);
  renderer.load(spcData);
  
  const wavData = renderer.render();
  
  fs.writeFileSync(options.outFile, wavData);
  console.log(`[RENDER] Saved ${options.outFile}`);
  
  // Print debug traces if enabled
  if (options.traceMix) {
    const trace = renderer['apu'].dsp.getMixTrace();
    if (trace.length > 0) {
      console.log('[TRACE] Mix events:');
      for (let i = 0; i < Math.min(5, trace.length); i++) {
        console.log(JSON.stringify(trace[i]));
      }
    }
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
