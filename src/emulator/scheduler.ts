import { Emulator } from './core';

// Very simple deterministic scheduler for tests: not cycle accurate.
// - stepScanline: executes N CPU instructions and signals PPU end-of-scanline
// - stepFrame: repeats scanlines for 262 lines
export class Scheduler {
  constructor(private emu: Emulator, private instrPerScanline = 100) {}

  stepScanline(): void {
    for (let i = 0; i < this.instrPerScanline; i++) {
      try {
        this.emu.stepInstruction();
      } catch (e) {
        // In tests, encountering BRK or unimplemented opcodes is acceptable to stop early
        break;
      }
    }
    this.emu.bus.getPPU().endScanline();
  }

  stepFrame(): void {
    const ppu = this.emu.bus.getPPU();
    ppu.startFrame();
    for (let sl = 0; sl < 262; sl++) {
      this.stepScanline();
    }
  }
}

