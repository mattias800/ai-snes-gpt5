import { Emulator } from './core';

export type CpuErrorMode = 'ignore' | 'throw' | 'record';

export interface SchedulerOptions {
  instrPerScanline?: number;
  onCpuError?: CpuErrorMode;
  traceEveryInstr?: number; // if >0, log CPU state every N instructions
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
  private traceEveryInstr = 0;
  private execCount = 0;

  constructor(private emu: Emulator, instrPerScanline = 100, opts: SchedulerOptions = {}) {
    this.instrPerScanline = opts.instrPerScanline ?? instrPerScanline;
    this.onCpuError = opts.onCpuError ?? 'ignore';
    this.traceEveryInstr = Math.max(0, opts.traceEveryInstr ?? 0) | 0;
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
        this.execCount++;
        if (this.traceEveryInstr > 0 && (this.execCount % this.traceEveryInstr) === 0) {
          const s = (this.emu.cpu as any).state ?? {};
          const pc = ` ${((s.PBR ?? 0) & 0xff).toString(16).padStart(2,'0')}:${((s.PC ?? 0) & 0xffff).toString(16).padStart(4,'0')}`;
          const reg = `P=${((s.P ?? 0) & 0xff).toString(16).padStart(2,'0')} A=${((s.A ?? 0) & 0xffff).toString(16).padStart(4,'0')} X=${((s.X ?? 0) & 0xffff).toString(16).padStart(4,'0')} Y=${((s.Y ?? 0) & 0xffff).toString(16).padStart(4,'0')} DBR=${((s.DBR ?? 0) & 0xff).toString(16).padStart(2,'0')} E=${(s.E ? '1' : '0')}`;
          // eslint-disable-next-line no-console
          console.log(`[TRACE]${pc} ${reg}`);
        }
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
          this.execCount++;
          if (this.traceEveryInstr > 0 && (this.execCount % this.traceEveryInstr) === 0) {
            const s = (this.emu.cpu as any).state ?? {};
            const pc = ` ${((s.PBR ?? 0) & 0xff).toString(16).padStart(2,'0')}:${((s.PC ?? 0) & 0xffff).toString(16).padStart(4,'0')}`;
            const reg = `P=${((s.P ?? 0) & 0xff).toString(16).padStart(2,'0')} A=${((s.A ?? 0) & 0xffff).toString(16).padStart(4,'0')} X=${((s.X ?? 0) & 0xffff).toString(16).padStart(4,'0')} Y=${((s.Y ?? 0) & 0xffff).toString(16).padStart(4,'0')} DBR=${((s.DBR ?? 0) & 0xff).toString(16).padStart(2,'0')} E=${(s.E ? '1' : '0')}`;
            // eslint-disable-next-line no-console
            console.log(`[TRACE]${pc} ${reg}`);
          }
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

    // Advance APU stub per scanline if available
    const busAny = this.emu.bus as any;
    if (typeof busAny.stepApuScanline === 'function') {
      busAny.stepApuScanline();
    }

    // Detect VBlank start transition (223 -> 224) and set RDNMI latch every frame.
    // Always pulse the bus latch so $4210 bit7 toggles regardless of NMI enable.
    if (prevScanline === 223 && ppu.scanline === 224) {
      if (!this.nmiFiredThisFrame) {
        if (typeof (this.emu.bus as any).pulseNMI === 'function') {
          (this.emu.bus as any).pulseNMI();
        }
        // Only deliver CPU NMI if enabled
        if (this.emu.bus.isNMIEnabled && this.emu.bus.isNMIEnabled()) {
          if (typeof (this.emu.cpu as any).nmi === 'function') {
            (this.emu.cpu as any).nmi();
          }
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

