import type { IPPU } from '../ppu/ipu';
import { NTSC } from '../timing/ntsc';

export interface TimingSchedulerOptions {
  onVBlankStart?: () => void;
}

// Deterministic dot-driven scheduler for timing tests. Does not step the CPU.
export class TimingScheduler {
  private ppu: IPPU;
  private opts: TimingSchedulerOptions;

  constructor(ppu: IPPU, opts: TimingSchedulerOptions = {}) {
    this.ppu = ppu;
    this.opts = opts;
  }

  stepDot = (): void => {
    const wasVBlank = this.ppu.isVBlank();
    this.ppu.stepDot();
    const isVBlank = this.ppu.isVBlank();
    // Detect VBlank start (224->224/0 edge in our scaffold constants)
    if (!wasVBlank && isVBlank && this.opts.onVBlankStart) this.opts.onVBlankStart();
  };

  stepScanline = (): void => {
    for (let i = 0; i < NTSC.dotsPerLine; i++) this.stepDot();
  };

  stepFrame = (): void => {
    for (let sl = 0; sl < NTSC.linesPerFrame; sl++) this.stepScanline();
  };

  now = (): { scanline: number; dot: number } => ({ scanline: this.ppu.getVCounter(), dot: this.ppu.getHCounter() });
}

