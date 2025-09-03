#!/usr/bin/env npx tsx
// SPC renderer with IRQ injection - fakes timer IRQs to drive music playback

import * as fs from 'fs';
import { APUDevice } from '../src/apu/apu';
import { loadSpcIntoApu } from '../src/apu/spc_loader';

class IRQInjector {
  private apu: APUDevice;
  private originalIrqVector: number = 0;
  private musicTickAddress: number = 0;
  private timerCounter: number = 0;
  private timerTarget: number = 16; // Default timer 0 target
  
  constructor(apu: APUDevice) {
    this.apu = apu;
  }

  init(): void {
    // Read the IRQ vector
    const irqLo = this.apu.aram[0xFFFE];
    const irqHi = this.apu.aram[0xFFFF];
    this.originalIrqVector = (irqHi << 8) | irqLo;
    
    // Read timer configuration
    const f1 = this.apu.aram[0xF1];
    const t0enabled = (f1 & 0x01) !== 0;
    const t0target = this.apu.aram[0xFA];
    
    if (t0enabled && t0target > 0) {
      this.timerTarget = t0target;
      console.log(`[IRQ] Timer 0 enabled, target=${this.timerTarget}`);
    }
    
    // Find the music tick routine
    this.musicTickAddress = this.findMusicTick();
    
    if (this.originalIrqVector === 0xFFFF || this.originalIrqVector === 0x0000) {
      console.log('[IRQ] No IRQ handler found, will inject fake handler');
      this.installFakeIRQ();
    } else {
      console.log(`[IRQ] Existing IRQ handler at $${this.originalIrqVector.toString(16)}`);
    }
  }

  private findMusicTick(): number {
    // Look for common music engine patterns
    console.log('[IRQ] Scanning for music tick routine...');
    
    // Strategy 1: Look for code that writes to DSP registers (especially KON)
    for (let addr = 0x200; addr < 0x2000; addr++) {
      // Look for pattern: MOV $F2,#$4C (writing to KON register)
      // 8F 4C F2 = MOV $F2,#$4C
      if (this.apu.aram[addr] === 0x8F && 
          this.apu.aram[addr + 1] === 0x4C && 
          this.apu.aram[addr + 2] === 0xF2) {
        // Found code that writes to KON register
        // Back up to find the routine start (usually after a RET or at a 16-byte boundary)
        for (let start = addr - 1; start >= addr - 0x100 && start >= 0; start--) {
          if (this.apu.aram[start] === 0x6F || // RET
              (start & 0x0F) === 0x00) { // 16-byte aligned
            console.log(`[IRQ] Found potential music tick at $${(start + 1).toString(16)} (KON write at $${addr.toString(16)})`);
            return start + 1;
          }
        }
      }
    }
    
    // Strategy 2: Look for routines that read timer counters
    for (let addr = 0x200; addr < 0x2000; addr++) {
      // MOV A,$FD (read timer 0 counter)
      if (this.apu.aram[addr] === 0xE4 && this.apu.aram[addr + 1] === 0xFD) {
        // Found timer read, this might be in the tick routine
        for (let start = addr - 1; start >= addr - 0x100 && start >= 0; start--) {
          if (this.apu.aram[start] === 0x6F || (start & 0x0F) === 0x00) {
            console.log(`[IRQ] Found potential tick routine at $${(start + 1).toString(16)} (timer read at $${addr.toString(16)})`);
            return start + 1;
          }
        }
      }
    }
    
    // Strategy 3: Common addresses used by various engines
    const commonAddresses = [0x0500, 0x0800, 0x0400, 0x0600, 0x0C00];
    for (const addr of commonAddresses) {
      const byte = this.apu.aram[addr];
      // Check if it looks like code (not 00 or FF)
      if (byte !== 0x00 && byte !== 0xFF) {
        // Check if it's a PUSH instruction (common at routine start)
        if (byte === 0x2D || byte === 0x4D || byte === 0x6D) { // PUSH A/X/Y
          console.log(`[IRQ] Found routine at common location $${addr.toString(16)}`);
          return addr;
        }
      }
    }
    
    console.log('[IRQ] No music tick routine found, will try blind injection');
    return 0;
  }

  private installFakeIRQ(): void {
    // Install a minimal IRQ handler that calls the music tick
    // We'll put it at $1F00 (usually safe area)
    const IRQ_HANDLER = 0x1F00;
    let offset = 0;
    
    // PUSH A
    this.apu.aram[IRQ_HANDLER + offset++] = 0x2D;
    // PUSH X  
    this.apu.aram[IRQ_HANDLER + offset++] = 0x4D;
    // PUSH Y
    this.apu.aram[IRQ_HANDLER + offset++] = 0x6D;
    
    if (this.musicTickAddress > 0) {
      // CALL music_tick
      this.apu.aram[IRQ_HANDLER + offset++] = 0x3F; // CALL abs
      this.apu.aram[IRQ_HANDLER + offset++] = this.musicTickAddress & 0xFF;
      this.apu.aram[IRQ_HANDLER + offset++] = (this.musicTickAddress >> 8) & 0xFF;
    }
    
    // Clear timer counter (acknowledge IRQ)
    // MOV A,$FD
    this.apu.aram[IRQ_HANDLER + offset++] = 0xE4;
    this.apu.aram[IRQ_HANDLER + offset++] = 0xFD;
    
    // POP Y
    this.apu.aram[IRQ_HANDLER + offset++] = 0xEE;
    // POP X
    this.apu.aram[IRQ_HANDLER + offset++] = 0xCE;
    // POP A
    this.apu.aram[IRQ_HANDLER + offset++] = 0xAE;
    // RETI
    this.apu.aram[IRQ_HANDLER + offset++] = 0x7F;
    
    // Install the vector
    this.apu.aram[0xFFFE] = IRQ_HANDLER & 0xFF;
    this.apu.aram[0xFFFF] = (IRQ_HANDLER >> 8) & 0xFF;
    
    console.log(`[IRQ] Installed fake handler at $${IRQ_HANDLER.toString(16)}`);
  }

  shouldTriggerIRQ(): boolean {
    // Simulate timer counting
    this.timerCounter++;
    if (this.timerCounter >= this.timerTarget * 8) { // Approximate timer rate
      this.timerCounter = 0;
      return true;
    }
    return false;
  }

  injectMusicTick(): void {
    // Directly call the music tick routine if we found it
    if (this.musicTickAddress > 0) {
      const oldPC = this.apu.smp.PC;
      const oldPSW = this.apu.smp.PSW;
      
      try {
        // Set PC to music tick routine
        this.apu.smp.PC = this.musicTickAddress;
        
        // Execute for limited cycles to avoid infinite loops
        let cycles = 0;
        const maxCycles = 2000;
        
        while (cycles < maxCycles) {
          const stepCycles = this.apu.smp.stepInstruction();
          cycles += stepCycles;
          
          // Check if we hit RET (0x6F)
          const currentPC = this.apu.smp.PC;
          if (this.apu.aram[currentPC - 1] === 0x6F) {
            break;
          }
        }
        
        if (cycles >= maxCycles) {
          console.log(`[IRQ] Warning: Music tick ran for ${cycles} cycles without returning`);
        }
      } catch (e) {
        // Ignore errors from unimplemented opcodes
      } finally {
        // Restore state
        this.apu.smp.PC = oldPC;
        this.apu.smp.PSW = oldPSW;
      }
    }
  }
}

function renderSPC(inputFile: string, outputFile: string, options: any = {}) {
  const seconds = options.seconds || 30;
  const sampleRate = options.sampleRate || 32000;
  const gain = options.gain || 5;
  const prerollMs = options.prerollMs || 200;
  
  console.log(`[RENDER] Loading ${inputFile}...`);
  const spcData = fs.readFileSync(inputFile);
  
  // Create APU and load SPC
  const apu = new APUDevice();
  loadSpcIntoApu(apu, spcData);
  apu.dsp.setMixGain(gain);
  
  // Patch wait loops
  patchWaitLoops(apu.aram);
  
  // Set up IRQ injection
  const irqInjector = new IRQInjector(apu);
  irqInjector.init();
  
  // Try to start music
  startMusic(apu);
  
  // Preroll
  const prerollSamples = Math.floor((prerollMs * sampleRate) / 1000);
  console.log(`[RENDER] Preroll ${prerollSamples} samples...`);
  
  for (let i = 0; i < prerollSamples; i++) {
    apu.step(32);
    
    // Check for timer IRQ
    if (irqInjector.shouldTriggerIRQ()) {
      // Try both methods: real IRQ and direct injection
      apu.smp.requestIRQ();
      irqInjector.injectMusicTick();
    }
    
    apu.dsp.mixSample(); // Discard
  }
  
  // Check initial state
  apu.dsp.writeAddr(0x4C);
  const initialKon = apu.dsp.readData();
  console.log(`[RENDER] After preroll: KON=${initialKon.toString(16).padStart(2, '0')}`);
  
  // Main render
  const totalSamples = Math.floor(seconds * sampleRate);
  const audioData: number[] = [];
  let peakL = 0, peakR = 0;
  let lastKon = initialKon;
  let konChanges = 0;
  
  console.log(`[RENDER] Rendering ${seconds} seconds...`);
  
  for (let i = 0; i < totalSamples; i++) {
    // Step APU
    apu.step(32);
    
    // Inject IRQ if timer expired
    if (irqInjector.shouldTriggerIRQ()) {
      apu.smp.requestIRQ();
      irqInjector.injectMusicTick();
    }
    
    // Mix audio
    const [l, r] = apu.dsp.mixSample();
    audioData.push(l, r);
    
    // Track peak
    peakL = Math.max(peakL, Math.abs(l));
    peakR = Math.max(peakR, Math.abs(r));
    
    // Monitor KON changes
    if (i % sampleRate === 0) {
      apu.dsp.writeAddr(0x4C);
      const kon = apu.dsp.readData();
      if (kon !== lastKon) {
        konChanges++;
        const time = i / sampleRate;
        console.log(`[RENDER] KON change at ${time}s: ${lastKon.toString(16)} -> ${kon.toString(16)}`);
        lastKon = kon;
      }
    }
  }
  
  const peakNorm = Math.max(peakL, peakR) / 32768;
  console.log(`[RENDER] Peak amplitude: ${(peakNorm * 100).toFixed(1)}%`);
  console.log(`[RENDER] KON changes: ${konChanges} (${konChanges > 0 ? 'MUSIC PLAYING!' : 'static'})`);
  
  // Create WAV
  const wav = createWAV(audioData, sampleRate);
  fs.writeFileSync(outputFile, wav);
  console.log(`[RENDER] Saved ${outputFile}`);
}

function patchWaitLoops(aram: Uint8Array): void {
  // Patch common wait loop patterns
  for (let addr = 0; addr < 0xFF00; addr++) {
    // MOV A,$00F4 / CMP A,#val / BNE
    if (aram[addr] === 0xE5 && aram[addr + 1] === 0xF4 && 
        aram[addr + 2] === 0x00 && aram[addr + 3] === 0x68 &&
        aram[addr + 5] === 0xD0) {
      const branchOffset = aram[addr + 6];
      const branchDest = addr + 7 + (branchOffset << 24 >> 24);
      if (branchDest <= addr && branchDest >= addr - 10) {
        console.log(`[PATCH] NOPing wait loop at $${addr.toString(16)}`);
        for (let i = 0; i < 7; i++) aram[addr + i] = 0x00;
      }
    }
  }
}

function startMusic(apu: APUDevice): void {
  // Try various start commands
  const startCommands = [
    { f4: 0x00, f5: 0x01 },
    { f4: 0x01, f5: 0x00 },
    { f4: 0xFF, f5: 0x01 },
  ];
  
  for (const cmd of startCommands) {
    apu.aram[0xF4] = cmd.f4;
    apu.aram[0xF5] = cmd.f5;
    
    // Run a bit to see if it responds
    for (let i = 0; i < 100; i++) {
      apu.step(32);
    }
    
    // Check if any voices got keyed on
    apu.dsp.writeAddr(0x4C);
    const kon = apu.dsp.readData();
    if (kon !== 0) {
      console.log(`[MUSIC] Start command worked: F4=${cmd.f4.toString(16)} F5=${cmd.f5.toString(16)}, KON=${kon.toString(16)}`);
      break;
    }
  }
}

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

// Main
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: spc_render_irq.ts <input.spc> <output.wav> [seconds] [gain]');
  process.exit(1);
}

const [input, output] = args;
const seconds = parseFloat(args[2]) || 30;
const gain = parseFloat(args[3]) || 5;

renderSPC(input, output, { seconds, gain });
