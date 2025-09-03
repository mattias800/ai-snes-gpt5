import { SDSP } from './sdsp';
import { APUTimer } from './timers';
import { SMP, SMPBus } from './smp';
import { SPC_IPL_ROM_U8 } from './spc_ipl';

// APU device exposing CPU/APU mailbox ports and SMP/DSP/timers.
// This is a functional skeleton designed for correctness tests, not timing.
export class APUDevice {
  // 64 KiB ARAM
  public readonly aram = new Uint8Array(0x10000);

  // DSP I/O access ring (records $F2/$F3 accesses)
  private dspIoRing: { kind: 'R'|'W'; addr: number; value: number; dspAddr: number; pc: number }[] = new Array(512);
  private dspIoPos = 0;
  private pushDspIo(kind: 'R'|'W', addr: number, value: number): void {
    const pc = ((this.smp as any)?.PC ?? 0) & 0xffff;
    const dspAddr = this.getDspAddr() & 0x7f;
    this.dspIoRing[this.dspIoPos % this.dspIoRing.length] = { kind, addr: addr & 0xffff, value: value & 0xff, dspAddr, pc };
    this.dspIoPos = (this.dspIoPos + 1) % this.dspIoRing.length;
  }
  getDspIoRing(): { kind: 'R'|'W'; addr: number; value: number; dspAddr: number; pc: number }[] {
    const out: { kind: 'R'|'W'; addr: number; value: number; dspAddr: number; pc: number }[] = [];
    for (let i = 0; i < this.dspIoRing.length; i++) {
      const idx = (this.dspIoPos + i) % this.dspIoRing.length;
      const it = this.dspIoRing[idx];
      if (it) out.push(it);
    }
    return out;
  }

  // Optional boot-time IPL HLE (CPU<->APU handshake & upload) state
  private bootIplHleEnabled = false;
  private bootIpl: { busy: boolean; toggle: boolean; expectAddrBytes: number; addr: number } = { busy: false, toggle: false, expectAddrBytes: 0, addr: 0 };

  // Mailbox ports
  private readonly cpuToApu = new Uint8Array(4); // visible to APU at $F4-$F7 (reads)
  private readonly apuToCpu = new Uint8Array(4); // visible to CPU at $2140-$2143 (reads)

  // I/O
  private testReg = 0; // $F0
  private controlReg = 0; // $F1 (timer enables/resets)
  private readonly dsp = new SDSP();
  private dspAddrMirror = 0; // mirror of last value written to $F2

  // Focused DSP write logging (optional)
  private logDspKeys = false;   // KON/KOF
  private logDspParams = false; // per-voice params (VOL, PITCH, SRCN, ADSR1/2, GAIN)

  // Timers (0/1 are 4-bit visible counters; 2 is 8-bit)
  private readonly t0 = new APUTimer(8, 16);
  private readonly t1 = new APUTimer(8, 16);
  private readonly t2 = new APUTimer(128, 256);

  // Optional: inject a maskable IRQ when timer0 increments (useful for some HLE flows).
  // Disabled by default; can be enabled via harness.
  private injectTimerIrq = false;

  // Optional I/O tracing for debugging
  private ioTrace = false;

  // SMP core
  private readonly smp: SMP;

  // Toggle for mapping the real IPL ROM at $FFC0-$FFFF. When false, reads fall through to ARAM
  private mapIplRom = true;

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
    // Read reset vector from IPL ROM and set PC
    const resetVecLo = this.read8(0xfffe);
    const resetVecHi = this.read8(0xffff);
    const resetVec = ((resetVecHi << 8) | resetVecLo) & 0xffff;
    (this.smp as any).PC = resetVec;
    // Reset boot IPL HLE state but keep enable flag
    this.bootIpl = { busy: false, toggle: false, expectAddrBytes: 0, addr: 0 };
  }

  // Bridge for SNES CPU side
  cpuWritePort(i: number, v: number): void {
    const idx = i & 3; const val = v & 0xff;
    this.cpuToApu[idx] = val;

    // Optional minimal boot IPL HLE: simple CC handshake + sequential upload via $2141
    if (this.bootIplHleEnabled) {
      if (idx === 0) {
        // $2140 control
        if (val === 0xcc) {
          // Begin busy phase; subsequent writes to $2141: addrL, addrH, then data stream
          this.bootIpl.busy = true;
          this.bootIpl.toggle = false;
          this.bootIpl.expectAddrBytes = 2;
        } else if (val === 0x00) {
          // End busy
          this.bootIpl.busy = false;
        }
      } else if (idx === 1) {
        // $2141 data/address
        if (this.bootIpl.busy) {
          if (this.bootIpl.expectAddrBytes > 0) {
            if (this.bootIpl.expectAddrBytes === 2) {
              this.bootIpl.addr = (this.bootIpl.addr & 0xff00) | (val & 0xff);
              this.bootIpl.expectAddrBytes = 1;
            } else {
              this.bootIpl.addr = ((val & 0xff) << 8) | (this.bootIpl.addr & 0x00ff);
              this.bootIpl.expectAddrBytes = 0;
            }
          } else {
            // Write sequential data into ARAM
            this.aram[this.bootIpl.addr & 0xffff] = val & 0xff;
            this.bootIpl.addr = (this.bootIpl.addr + 1) & 0xffff;
          }
        }
      }
    }

    // Wake SMP from sleep on CPU->APU mailbox activity
    this.smp.wakeFromSleep();
  }
  cpuReadPort(i: number): number {
    const idx = i & 3;
    if (this.bootIplHleEnabled && idx === 0 && this.bootIpl.busy) {
      // Busy pattern: toggle bit7 between 0 and 1 on each read
      this.bootIpl.toggle = !this.bootIpl.toggle;
      return this.bootIpl.toggle ? 0x80 : 0x00;
    }
    return this.apuToCpu[idx] & 0xff;
  }

  // APU-side read/write (SMP Bus)
  private read8(addr: number): number {
    const a = addr & 0xffff;
    // Map SPC700 IPL ROM at 0xFFC0..0xFFFF (read-only) when enabled
    if (this.mapIplRom && a >= 0xffc0 && a <= 0xffff) {
      return SPC_IPL_ROM_U8[a - 0xffc0] & 0xff;
    }
    if ((a & 0xfff0) === 0x00f0) {
      switch (a & 0xff) {
        case 0xf0: return this.testReg & 0xff;
        case 0xf1: return this.controlReg & 0xff;
        case 0xf2: { // DSP address
          // Reading $F2 returns last address (mirrors hardware behavior loosely)
          const v = this.getDspAddr() & 0xff;
          this.pushDspIo('R', a, v);
          return v;
        }
        case 0xf3: { const v = (this.dsp.readData() & 0xff); this.pushDspIo('R', a, v); return v; }
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
    // Ignore writes to IPL ROM region
    if (a >= 0xffc0 && a <= 0xffff) return;
    if ((a & 0xfff0) === 0x00f0) {
      switch (a & 0xff) {
        case 0xf0: {
          this.testReg = v;
          if (this.ioTrace) this.logIo('W', a, v, 'TEST');
          return;
        }
        case 0xf1: {
          if (this.ioTrace) this.logIo('W', a, v, 'CTRL');
          this.writeControl(v);
          return;
        }
        case 0xf2: {
          this.setDspAddr(v);
          if (this.ioTrace) this.logIo('W', a, v, `DSPADDR<=${this.hex2(this.getDspAddr())}`);
          this.pushDspIo('W', a, v);
          return;
        }
        case 0xf3: {
          const d = this.getDspAddr() & 0x7f;
          if (this.ioTrace) this.logIo('W', a, v, `DSP[${this.hex2(d)}]`);
          this.dsp.writeData(v);
          this.pushDspIo('W', a, v);
          // Focused logging: KON/KOF and per-voice params
          if (this.logDspKeys && (d === 0x4c || d === 0x5c)) {
            const pc = this.hex4(((this.smp as any)?.PC ?? 0) & 0xffff);
            const kind = (d === 0x4c) ? 'KON' : 'KOF';
            // eslint-disable-next-line no-console
            console.log(`[DSPWR][${kind}] pc=${pc} ${kind}<=${this.hex2(v)}`);
          }
          if (this.logDspParams) {
            // Voice params live at addresses v*0x10 + idx where idx in [0..7]
            if (((d & 0x0f) <= 0x07) && ((d >>> 4) < 8)) {
              const vIdx = (d >>> 4) & 0x07;
              const pIdx = d & 0x0f;
              const names = ['VL','VR','PITCHL','PITCHH','SRCN','ADSR1','ADSR2','GAIN'] as const;
              const name = names[pIdx] ?? `P${pIdx}`;
              const pc = this.hex4(((this.smp as any)?.PC ?? 0) & 0xffff);
              // eslint-disable-next-line no-console
              console.log(`[DSPWR][V${vIdx}] pc=${pc} ${name}<=${this.hex2(v)} (addr=${this.hex2(d)})`);
            }
          }
          return;
        }
        case 0xf4: case 0xf5: case 0xf6: case 0xf7: {
          this.apuToCpu[a & 3] = v;
          if (this.ioTrace) this.logIo('W', a, v, `PORT${(a & 3)}`);
          return;
        }
        case 0xfa: { this.t0.setTarget(v); if (this.ioTrace) this.logIo('W', a, v, 'T0TGT'); return; }
        case 0xfb: { this.t1.setTarget(v); if (this.ioTrace) this.logIo('W', a, v, 'T1TGT'); return; }
        case 0xfc: { this.t2.setTarget(v); if (this.ioTrace) this.logIo('W', a, v, 'T2TGT'); return; }
        case 0xfd: { this.t0.clearCounter(); if (this.ioTrace) this.logIo('W', a, v, 'T0CLR'); return; }
        case 0xfe: { this.t1.clearCounter(); if (this.ioTrace) this.logIo('W', a, v, 'T1CLR'); return; }
        case 0xff: { this.t2.clearCounter(); if (this.ioTrace) this.logIo('W', a, v, 'T2CLR'); return; }
        default: return;
      }
    }
    this.aram[a] = v;
  }

  private getDspAddr(): number {
    return this.dspAddrMirror & 0x7f;
  }
  private setDspAddr(v: number): void {
    this.dspAddrMirror = v & 0x7f;
    this.dsp.writeAddr(v & 0xff);
  }

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
          // Timer activity can be used to wake the SMP from SLEEP state
          this.smp.wakeFromSleep();
          // Optional: inject a maskable IRQ on timer0 increments (off by default)
          if (this.injectTimerIrq && inc0 > 0) (this.smp as any).requestIRQ?.();
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
        // Timer activity can be used to wake the SMP from SLEEP state
        this.smp.wakeFromSleep();
        if (this.injectTimerIrq && inc0 > 0) (this.smp as any).requestIRQ?.();
      }
      budget -= tickn;
    }
  }

  // Produce one stereo sample using the DSP
  mixSample(): [number, number] {
    return this.dsp.mixSample();
  }

  // Debug: enable or disable I/O tracing
  setIoTrace(on: boolean): void { this.ioTrace = !!on; }

  private hex2(n: number): string { return (n & 0xff).toString(16).padStart(2, '0'); }
  private hex4(n: number): string { return (n & 0xffff).toString(16).padStart(4, '0'); }
  private logIo(kind: 'R' | 'W', addr: number, value: number, note?: string) {
    const a = addr & 0xffff; const v = value & 0xff;
    const pc = this.smp ? this.hex4((this.smp as any).PC ?? 0) : '----';
    // eslint-disable-next-line no-console
    console.log(`[APU.IO] ${kind} ${this.hex4(a)} <= ${this.hex2(v)} PC=${pc}${note ? ' ' + note : ''}`);
  }

  setMixGain(g: number): void {
    (this.dsp as any).setMixGain?.(g);
  }

  // Config toggles
  setIplHleForNullIrqVectors(on: boolean): void { (this.smp as any).setIplHleForNullIrqVectors?.(on); }
  setBootIplHle(on: boolean): void { this.bootIplHleEnabled = !!on; }
  setTimerIrqInjection(on: boolean): void { this.injectTimerIrq = !!on; }
  setSmpLowPowerDisabled(on: boolean): void { (this.smp as any).setLowPowerDisabled?.(on); }
  setMapIplRom(on: boolean): void { this.mapIplRom = !!on; }
  setDspWriteLogging(keys: boolean, params: boolean): void { this.logDspKeys = !!keys; this.logDspParams = !!params; }

  // Debug helpers
  setVoiceMask(mask: number): void { (this.dsp as any).setVoiceMask?.(mask); }
  beginMixTrace(maxFrames: number): void { (this.dsp as any).beginMixTrace?.(maxFrames); }
  endMixTrace(): void { (this.dsp as any).endMixTrace?.(); }
  getMixTrace(): any[] { return (this.dsp as any).getMixTrace?.() || []; }
  setForcePan(voiceIndex: number, frames: number): void { (this.dsp as any).setForcePan?.(voiceIndex, frames); }

  // Initialize IO registers ($F1 control and timer targets) from an SPC snapshot
  setIoFromSnapshot(f1: number, t0Target: number, t1Target: number, t2Target: number): void {
    // Set timer targets first, then control to apply enables/resets
    this.t0.setTarget(t0Target & 0xff);
    this.t1.setTarget(t1Target & 0xff);
    this.t2.setTarget(t2Target & 0xff);
    this.writeControl(f1 & 0xff);
  }
}
