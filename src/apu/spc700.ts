// Minimal SPC700 stub focusing on APU port handshakes and timing.
// This is NOT a full SPC700 CPU. It provides a deterministic, configurable
// state machine that emulates the common boot/handshake behavior so the
// main CPU can progress. It can be replaced with a real SPC700 core later.

import { APUDevice } from './apu';

export class SPC700 {
  // CPU-visible APU ports ($F4-$F7) mirrored at SNES $2140-$2143
  private toCpu = new Uint8Array(4);   // values read by CPU at $2140-$2143
  private fromCpu = new Uint8Array(4); // last values written by CPU

  // Handshake / script state
  private phase: 'boot' | 'acked' | 'busy' | 'done' = 'boot';
  private scriptActive = false;
  private scriptIndex = 0;
  private script: { value: number, cycles: number }[] = [];
  private cyclesPerStep = 1; // decrement per SPC cycle

  // SMW-oriented handshake state
  private smwMode = false;           // when true, use CC->00 echo, then mirror $2140 writes
  private seenCC = false;            // has CPU written 0xCC to port0
  private echoCcReads = 0;           // how many reads should echo 0xCC
  private echoZeroReads = 0;         // how many reads should echo 0x00
  private echoPort0AfterCC = true;   // mirror subsequent $2140 writes after CC
  private uploadCount = 0;           // number of writes observed to port1 ($2141)
  private uploadThreshold = 2048;    // completion threshold for uploads

  // Configurable parameters
  private donePort0Value = 0x00; // value on port0 when done
  private enableScript = false;  // if true, use scripted 0x80 -> 0x00 -> ready (non-SMW)
  private phase1Cycles = 512;    // cycles of 0x80 (non-SMW)
  private phase2Cycles = 512;    // cycles of 0x00 (non-SMW)

  private apuCore: APUDevice | null = null;

  constructor(env: Record<string, string | undefined> = (typeof process !== 'undefined' && process?.env ? (process.env as Record<string, string | undefined>) : {})) {
    // Optional: enable real APU core in "core" mode without disrupting existing shim behavior
    const enableCore = (env.APU_SPC700_CORE === '1' || env.APU_SPC700_MODE === 'core' || env.SMW_SPC700_MODE === 'core');
    if (enableCore) {
      try {
        this.apuCore = new APUDevice();
      } catch { this.apuCore = null; }
    }

    // Initial boot signature values often expected by games
    this.toCpu[0] = 0xaa;
    this.toCpu[1] = 0xbb;
    this.toCpu[2] = 0x00;
    this.toCpu[3] = 0x00;

    // Config from env
    const doneRaw = env.SMW_APU_SHIM_DONE_PORT0 ?? env.APU_DONE_PORT0;
    if (doneRaw) {
      const cleaned = doneRaw.toLowerCase().replace(/^\$/,'');
      const v = cleaned.startsWith('0x') ? Number(cleaned) : (/^[0-9a-f]+$/i.test(cleaned) ? parseInt(cleaned, 16) : Number(cleaned));
      if (Number.isFinite(v) && v >= 0 && v <= 255) this.donePort0Value = (v as number) & 0xff;
    }
    const scriptName = (env.SMW_APU_SHIM_SCRIPT ?? env.APU_SCRIPT ?? '').toString().toLowerCase();
    // If "smw" is selected, prefer SMW-specific echo mode rather than the generic 0x80/0x00 script
    if (scriptName === 'smw') {
      this.smwMode = true;
      this.enableScript = false;
      // These control how many reads echo CC then 00 immediately after CC is written
      const p1r = Number(env.SMW_APU_SHIM_SMW_PHASE1 ?? '2');
      const p2r = Number(env.SMW_APU_SHIM_SMW_PHASE2 ?? '1');
      if (Number.isFinite(p1r) && p1r > 0) this.echoCcReads = p1r | 0;
      if (Number.isFinite(p2r) && p2r > 0) this.echoZeroReads = p2r | 0;
    } else {
      // Non-SMW scripted mode: 0x80 for phase1Cycles, then 0x00 for phase2Cycles, then done
      this.enableScript = (scriptName.length > 0);
      const p1 = Number(env.SMW_APU_SHIM_SMW_PHASE1 ?? env.APU_SCRIPT_PHASE1 ?? '512');
      const p2 = Number(env.SMW_APU_SHIM_SMW_PHASE2 ?? env.APU_SCRIPT_PHASE2 ?? '512');
      if (Number.isFinite(p1) && p1 > 0) this.phase1Cycles = p1 | 0;
      if (Number.isFinite(p2) && p2 > 0) this.phase2Cycles = p2 | 0;
    }
    const upThresh = Number(env.SMW_APU_UPLOAD_THRESHOLD ?? env.APU_UPLOAD_THRESHOLD ?? '2048');
    if (Number.isFinite(upThresh) && upThresh > 0) this.uploadThreshold = upThresh | 0;
    this.echoPort0AfterCC = !(env.SMW_SPC700_ECHO_PORT0 === '0' || env.SMW_SPC700_ECHO_PORT0 === 'false');
  }

  // Called by SNES CPU writes to $2140-$2143
  public cpuWritePort(idx: number, value: number): void {
    if (this.apuCore) { this.apuCore.cpuWritePort(idx & 3, value & 0xff); return; }
    const v = value & 0xff;
    this.fromCpu[idx & 3] = v;

    // SMW-centric path
    if (this.smwMode) {
      if (idx === 0) {
        if (v === 0xcc) {
          // Begin handshake: echo CC a few reads, then 00
          this.seenCC = true;
          this.phase = 'busy';
          // Reset echo windows from env defaults if zeroed
          if (this.echoCcReads <= 0) this.echoCcReads = 2;
          if (this.echoZeroReads <= 0) this.echoZeroReads = 1;
        } else if (this.seenCC) {
          // After CC, port0 mirrors writes even if we're technically 'done'.
          // SMW expects $2140 to reflect the last index value it wrote.
          if (this.echoPort0AfterCC) {
            this.toCpu[0] = v;
          }
        }
      } else if (idx === 1) {
        // Count uploads via $2141 writes
        if (this.seenCC && this.phase !== 'done') {
          this.uploadCount++;
          if (this.uploadCount >= this.uploadThreshold) {
            this.finish();
          }
        }
      }
      return;
    }

    // Generic non-SMW scripted behavior
    // Heuristic handshake similar to Nintendo IPL expectations
    if (idx === 0 && v === 0xcc) {
      // APU acknowledge reset/init request
      this.toCpu[0] = 0x00;
      this.phase = 'acked';
      // Start script after CC if enabled
      if (this.enableScript) {
        this.scriptActive = true;
        this.phase = 'busy';
        this.scriptIndex = 0;
        this.script = [
          { value: 0x80, cycles: this.phase1Cycles },
          { value: 0x00, cycles: this.phase2Cycles },
          { value: this.donePort0Value & 0xff, cycles: -1 },
        ];
        // Signal progress on port1 once we reach the final stage (ready)
        // We set it early here so the CPU can observe it any time during final stage.
        this.toCpu[1] = 0x02;
      } else {
        // Without script, enter busy and toggle in step() (if desired by host)
        this.phase = 'busy';
      }
    }
  }

  // Called by SNES CPU reads from $2140-$2143
  public cpuReadPort(idx: number): number {
    if (this.apuCore) { return this.apuCore.cpuReadPort(idx & 3) & 0xff; }
    const i = idx & 3;
    if (this.smwMode && i === 0) {
      // In SMW mode, always honor the echo windows first.
      if (this.echoCcReads > 0) { this.echoCcReads--; return 0xcc; }
      if (this.echoZeroReads > 0) { this.echoZeroReads--; return 0x00; }
      // If handshake is marked done, tests expect port0 to hold a stable done value.
      if (this.phase === 'done') return this.donePort0Value & 0xff;
      // Otherwise mirror the last CPU write to $2140 during busy/after CC.
      if (this.seenCC && this.echoPort0AfterCC) {
        return this.fromCpu[0] & 0xff;
      }
      // Otherwise, fall back to initial boot values.
    }
    return this.toCpu[i] & 0xff;
  }

  // Advance the SPC by a number of internal cycles
  public step(cycles: number): void {
    if (this.apuCore) { this.apuCore.step(cycles | 0); return; }
    let c = cycles | 0;
    if (c <= 0) return;

    // In SMW mode, completion is driven by $2141 write counts; nothing to do per-cycle here.

    if (this.phase === 'busy' && this.scriptActive) {
      // Drive sequence per cycles budget
      while (c > 0 && this.scriptActive) {
        const cur = this.script[this.scriptIndex];
        if (!cur) {
          this.finish();
          break;
        }
        // Drive port0
        this.toCpu[0] = cur.value & 0xff;
        if (cur.cycles !== -1) {
          const take = Math.min(this.cyclesPerStep, cur.cycles);
          cur.cycles -= take;
          c -= take;
          if (cur.cycles <= 0) this.scriptIndex++;
        } else {
          // Infinite final stage
          c = 0;
        }
      }
    }
  }

  private finish(): void {
    this.scriptActive = false;
    this.phase = 'done';
    // Hold done value on port0 for deterministic tests
    this.toCpu[0] = this.donePort0Value & 0xff;
    // Optionally indicate ready on port1
    this.toCpu[1] = 0x02;
  }
}
