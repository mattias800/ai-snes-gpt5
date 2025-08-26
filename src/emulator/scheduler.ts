import { Emulator } from './core';

export type CpuErrorMode = 'ignore' | 'throw' | 'record';

export interface SchedulerOptions {
  instrPerScanline?: number;
  onCpuError?: CpuErrorMode;
}

// Very simple deterministic scheduler for tests: not cycle accurate.
// - stepScanline: executes N CPU instructions and signals PPU end-of-scanline
// - stepFrame: repeats scanlines for 262 lines
export class Scheduler {
  private instrPerScanline: number;
  private onCpuError: CpuErrorMode;
  public lastCpuError: unknown | undefined;
  // Ensure we fire NMI only once per frame at VBlank start
  private nmiFiredThisFrame = false;

  constructor(private emu: Emulator, instrPerScanline = 100, opts: SchedulerOptions = {}) {
    this.instrPerScanline = opts.instrPerScanline ?? instrPerScanline;
    this.onCpuError = opts.onCpuError ?? 'ignore';
  }

  stepScanline(): void {
    const ppu = this.emu.bus.getPPU();
    const prevScanline = ppu.scanline;

    // Coarse HBlank window: last ~1/8th of the scanline
    const hblankInstr = Math.max(1, Math.floor(this.instrPerScanline / 8));
    const visibleInstr = Math.max(0, this.instrPerScanline - hblankInstr);

    // Visible part
    ppu.hblank = false;
    for (let i = 0; i < visibleInstr; i++) {
      try {
        this.emu.stepInstruction();
      } catch (e) {
        this.lastCpuError = e;
        if (this.onCpuError === 'throw') throw e;
        // If error in visible part, stop executing this scanline
        break;
      }
    }

    // HBlank part
    if (!this.lastCpuError) {
      ppu.hblank = true;
      for (let i = 0; i < hblankInstr; i++) {
        try {
          this.emu.stepInstruction();
        } catch (e) {
          this.lastCpuError = e;
          if (this.onCpuError === 'throw') throw e;
          break;
        }
      }
    }

    // After executing, clear hblank and advance scanline
    ppu.hblank = false;

    // Advance PPU timing one scanline
    ppu.endScanline();

    // Detect VBlank start transition (223 -> 224) and pulse NMI once per frame
    if (prevScanline === 223 && ppu.scanline === 224 && this.emu.bus.isNMIEnabled && this.emu.bus.isNMIEnabled()) {
      if (!this.nmiFiredThisFrame) {
        if (typeof (this.emu.bus as any).pulseNMI === 'function') {
          (this.emu.bus as any).pulseNMI();
        }
        if (typeof (this.emu.cpu as any).nmi === 'function') {
          (this.emu.cpu as any).nmi();
        }
        this.nmiFiredThisFrame = true;
      }
    }

    // If we wrapped to the top of the frame, reset NMI firing state for the next frame
    if (ppu.scanline === 0) {
      this.nmiFiredThisFrame = false;
    }
  }

  stepFrame(): void {
    this.lastCpuError = undefined;
    const ppu = this.emu.bus.getPPU();
    this.nmiFiredThisFrame = false;
    ppu.startFrame();
    for (let sl = 0; sl < 262; sl++) {
      this.stepScanline();
    }
  }
}

