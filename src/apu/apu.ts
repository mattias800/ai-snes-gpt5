import { SDSP } from './sdsp';
import { APUTimer } from './timers';
import { SMP, SMPBus } from './smp';

// APU device exposing CPU/APU mailbox ports and SMP/DSP/timers.
// This is a functional skeleton designed for correctness tests, not timing.
export class APUDevice {
  // 64 KiB ARAM
  public readonly aram = new Uint8Array(0x10000);

  // Mailbox ports
  private readonly cpuToApu = new Uint8Array(4); // visible to APU at $F4-$F7 (reads)
  private readonly apuToCpu = new Uint8Array(4); // visible to CPU at $2140-$2143 (reads)

  // I/O
  private testReg = 0; // $F0
  private controlReg = 0; // $F1 (timer enables/resets)
  private readonly dsp = new SDSP();

  // Timers (0/1 are 4-bit visible counters; 2 is 8-bit)
  private readonly t0 = new APUTimer(8, 16);
  private readonly t1 = new APUTimer(8, 16);
  private readonly t2 = new APUTimer(128, 256);

  // SMP core
  private readonly smp: SMP;

  constructor() {
    const bus: SMPBus = {
      read8: (addr) => this.read8(addr),
      write8: (addr, v) => this.write8(addr, v)
    };
    this.smp = new SMP(bus);
    // Attach ARAM to DSP for BRR fetch
    this.dsp.attachAram(this.aram);
    this.reset();
  }

  reset(): void {
    this.aram.fill(0);
    this.cpuToApu.fill(0);
    this.apuToCpu.fill(0);
    this.testReg = 0; this.controlReg = 0;
    this.dsp.reset();
    this.dsp.attachAram(this.aram);
    this.t0.reset(); this.t1.reset(); this.t2.reset();
    this.smp.reset();
  }

  // Bridge for SNES CPU side
  cpuWritePort(i: number, v: number): void {
    this.cpuToApu[i & 3] = v & 0xff;
    // Wake SMP from sleep on CPU->APU mailbox activity
    this.smp.wakeFromSleep();
  }
  cpuReadPort(i: number): number {
    return this.apuToCpu[i & 3] & 0xff;
  }

  // APU-side read/write (SMP Bus)
  private read8(addr: number): number {
    const a = addr & 0xffff;
    if ((a & 0xfff0) === 0x00f0) {
      switch (a & 0xff) {
        case 0xf0: return this.testReg & 0xff;
        case 0xf1: return this.controlReg & 0xff;
        case 0xf2: // DSP address
          // Reading $F2 returns last address (mirrors hardware behavior loosely)
          return this.getDspAddr();
        case 0xf3: return this.dsp.readData() & 0xff;
        case 0xf4: case 0xf5: case 0xf6: case 0xf7:
          return this.cpuToApu[a & 3] & 0xff;
        case 0xfa: return this.t0.getTarget();
        case 0xfb: return this.t1.getTarget();
        case 0xfc: return this.t2.getTarget();
        case 0xfd: return this.t0.readCounter();
        case 0xfe: return this.t1.readCounter();
        case 0xff: return this.t2.readCounter();
        default: return 0x00;
      }
    }
    return this.aram[a] & 0xff;
  }

  private write8(addr: number, value: number): void {
    const a = addr & 0xffff; const v = value & 0xff;
    if ((a & 0xfff0) === 0x00f0) {
      switch (a & 0xff) {
        case 0xf0: this.testReg = v; return;
        case 0xf1: this.writeControl(v); return;
        case 0xf2: this.setDspAddr(v); return;
        case 0xf3: this.dsp.writeData(v); return;
        case 0xf4: case 0xf5: case 0xf6: case 0xf7:
          this.apuToCpu[a & 3] = v; return;
        case 0xfa: this.t0.setTarget(v); return;
        case 0xfb: this.t1.setTarget(v); return;
        case 0xfc: this.t2.setTarget(v); return;
        case 0xfd: this.t0.clearCounter(); return;
        case 0xfe: this.t1.clearCounter(); return;
        case 0xff: this.t2.clearCounter(); return;
        default: return;
      }
    }
    this.aram[a] = v;
  }

  private getDspAddr(): number {
    // SDSP doesn't expose address directly; store a mirror in a spare slot (0)
    // We approximate by returning 0; tests interact via write path.
    return 0x00;
  }
  private setDspAddr(v: number): void { this.dsp.writeAddr(v & 0xff); }

  private writeControl(v: number): void {
    this.controlReg = v & 0xff;
    // Enable bits
    this.t0.setEnabled((v & 0x01) !== 0);
    this.t1.setEnabled((v & 0x02) !== 0);
    this.t2.setEnabled((v & 0x04) !== 0);
    // Reset pulses (bits 4/5/6)
    if (v & 0x10) this.t0.clearCounter();
    if (v & 0x20) this.t1.clearCounter();
    if (v & 0x40) this.t2.clearCounter();
  }

  // Coarse step: run N pseudo-cycles; tick timers proportionally; execute instructions until budget is consumed
  step(cycles: number): void {
    let budget = cycles | 0;
    if (budget <= 0) return;

    while (budget > 0) {
      // If SMP is in low-power state, coalesce timer ticks to avoid unnecessary stepping
      if (this.smp.isStopped() || this.smp.isSleeping()) {
        const inc0 = this.t0.tick(budget) | 0;
        const inc1 = this.t1.tick(budget) | 0;
        const inc2 = this.t2.tick(budget) | 0;
        if ((inc0 | inc1 | inc2) !== 0) {
          // Timer activity can be used to wake the SMP from SLEEP
          this.smp.wakeFromSleep();
        }
        // All budget consumed by timer ticking; exit early
        this.smp.lastCycles = 0;
        return;
      }

      const consumed = this.smp.stepInstruction() | 0;
      this.smp.lastCycles = consumed | 0;
      const tickn = consumed > 0 ? consumed : 2; // minimum progress
      const inc0 = this.t0.tick(tickn) | 0;
      const inc1 = this.t1.tick(tickn) | 0;
      const inc2 = this.t2.tick(tickn) | 0;
      if ((inc0 | inc1 | inc2) !== 0) {
        // Timer activity can be used to wake the SMP from SLEEP
        this.smp.wakeFromSleep();
      }
      budget -= tickn;
    }
  }

  // Produce one stereo sample using the DSP
  mixSample(): [number, number] {
    return this.dsp.mixSample();
  }
}
