// Minimal S-DSP register window model with basic BRR mixing (approximate)
// Accessed via APU $F2 (address) and $F3 (data)

export class SDSP {
  private regs = new Uint8Array(128);
  private addr = 0; // 7-bit address latch
  // ENDX status bits (bit i set when voice i reached END in a block); cleared on read of 0x7F
  private endxMask = 0;

  // Attached ARAM (64 KiB)
  private aram: Uint8Array | null = null;

  // Voice runtime state
  private voices: Voice[] = Array.from({ length: 8 }, (_, i) => new Voice(i));

  // Cached global params
  private dirBase = 0; // sample directory base (DIR<<8)

  // Echo state backed by ARAM
  private eonMask = 0; // EON per-voice mask
  private esaBase = 0; // ESA base address in ARAM (ESA<<8)
  private echoFrames = 512; // frames (EDL * 512), default to 512
  private echoPosFrame = 0; // current frame index within echo ring
  private flg = 0; // FLG register mirror
  private mute = false; // FLG bit 6
  private echoWriteDisable = false; // FLG bit 5

  // Debug snapshot of last mix
  public debug: { dryL:number; dryR:number; echoInL:number; echoInR:number; firL:number; firR:number; outL:number; outR:number; mvolL:number; mvolR:number; evolL:number; evolR:number } | null = null;

  // Output scaling (applied to mix just before final clamp)
  private mixGain = 1.0;
  setMixGain(g: number) { this.mixGain = Math.max(0.0001, g); }

  // Debug envelope tracing
  private traceEnv = false;
  private envTrace: string[] = [];
  setTraceEnvelope(enabled: boolean) { this.traceEnv = !!enabled; this.envTrace = []; }
  getEnvelopeTrace(): string[] { return this.envTrace.slice(); }

  // Voice mask and mix tracing
  private voiceMask = 0xff;
  setVoiceMask(mask: number) { this.voiceMask = mask & 0xff; }

  private traceMix = false;
  private traceMaxFrames = 0;
  private traceFrames: any[] = [];
  // Optional decode trace (first N decodeNext events)
  private decodeTraceMax = 0;
  private decodeTrace: any[] = [];
  setDecodeTrace(maxEvents: number) {
    this.decodeTraceMax = Math.max(0, maxEvents|0);
    this.decodeTrace = [];
  }
  getDecodeTrace(): any[] { return this.decodeTrace.slice(); }

  // Guard counters to detect a dead left pipeline while right has signal
  private guardLZero = 0;
  private guardRNonZero = 0;
  // Force-pan debug (index: 0..7, -1 disables). Applies for given number of mixSample frames
  private forcePanVoice = -1;
  private forcePanFramesLeft = 0;
  setForcePan(voiceIndex: number, frames: number) {
    this.forcePanVoice = (voiceIndex|0);
    this.forcePanFramesLeft = Math.max(0, frames|0);
  }
  beginMixTrace(maxFrames: number) {
    this.traceMix = true; this.traceMaxFrames = Math.max(0, maxFrames|0); this.traceFrames = [];
    this.guardLZero = 0; this.guardRNonZero = 0;
  }
  endMixTrace() { this.traceMix = false; }
  getMixTrace(): any[] { return this.traceFrames.slice(); }

  attachAram(aram: Uint8Array) { this.aram = aram; }

  reset(): void {
    this.regs.fill(0);
    this.addr = 0;
    for (const v of this.voices) v.hardReset();
    this.dirBase = 0;
    this.eonMask = 0;
    this.esaBase = 0;
    this.echoFrames = 512;
    this.echoPosFrame = 0;
    this.flg = 0;
    this.mute = false;
    this.echoWriteDisable = false;
  }

  // APU writes to $F2
  writeAddr(v: number): void {
    this.addr = v & 0x7f;
  }

  // APU writes to $F3
  writeData(v: number): void {
    const a = this.addr & 0x7f;
    const val = v & 0xff;
    this.regs[a] = val;

    // Global regs
    switch (a) {
      case 0x5d: // DIR (sample directory base)
        this.dirBase = (val & 0xff) << 8;
        return;
      case 0x4d: // EON
        this.eonMask = val & 0xff; return;
      case 0x6d: // ESA (echo start address)
        this.esaBase = (val & 0xff) << 8; return;
      case 0x7d: { // EDL (echo delay length)
        const edl = val & 0x0f;
        this.echoFrames = Math.max(1, edl) * 512; // each unit = 512 stereo frames
        this.echoPosFrame = 0; // reset pointer for determinism
        return;
      }
      case 0x6c: { // FLG
        this.flg = val & 0xff;
        this.mute = (this.flg & 0x40) !== 0;
        this.echoWriteDisable = (this.flg & 0x20) !== 0;
        if ((this.flg & 0x80) !== 0) {
          // Soft reset DSP runtime state (don't clear regs or ARAM)
          for (const v of this.voices) { v.active = false; v.phase = 0; v.primed = false; v.prev1 = v.prev2 = 0; v.h0 = v.h1 = v.h2 = v.h3 = 0; v.env = 0; v.envPhase = 0; }
          this.echoPosFrame = 0;
        }
        return;
      }
      case 0x4c: { // KON
        const mask = val & 0xff;
        for (let i = 0; i < 8; i++) if (mask & (1 << i)) this.keyOn(i);
        return;
      }
      case 0x5c: { // KOF
        const mask = val & 0xff;
        for (let i = 0; i < 8; i++) if (mask & (1 << i)) this.keyOff(i);
        return;
      }
      default:
        break;
    }

    // Per-voice regs (offset within voice block is low nibble; voice index is high nibble)
    const off = a & 0x0f; // 0x00..0x0f
    if (off <= 0x07) {
      const voice = (a >>> 4) & 0x07; // 0..7
      const vstate = this.voices[voice];
      switch (off) {
        case 0x00: // VOL(L)
          vstate.volL = (val << 24) >> 24; // signed 8-bit
          break;
        case 0x01: // VOL(R)
          vstate.volR = (val << 24) >> 24;
          break;
        case 0x02: // PITCHL
          vstate.pitch = (vstate.pitch & 0x3f00) | (val & 0xff);
          break;
        case 0x03: // PITCHH (14-bit)
          vstate.pitch = ((val & 0x3f) << 8) | (vstate.pitch & 0xff);
          if (vstate.pitch < 0) vstate.pitch = 0;
          break;
        case 0x04: // SRCN
          vstate.srcn = val & 0xff;
          break;
        case 0x05: // ADSR1
          vstate.adsr1 = val & 0xff;
          break;
        case 0x06: // ADSR2
          vstate.adsr2 = val & 0xff;
          break;
        case 0x07: // GAIN
          vstate.gain = val & 0xff;
          break;
      }
    }
  }

  private keyOn(i: number) {
    const v = this.voices[i];
    if (!this.aram) return;
    // Fetch sample/loop pointers from directory
    const base = (this.dirBase + (v.srcn & 0xff) * 4) & 0xffff;
    const start = this.readWord(base);
    const loop = this.readWord((base + 2) & 0xffff);
    v.startAddr = start & 0xffff;
    v.loopAddr = loop & 0xffff;
    // Note: Some samples start with a header that has END flag set.
    // This is normal - they'll decode 16 samples then jump to loop.
    v.startKeyOn();
  }

  private keyOff(i: number) {
    const v = this.voices[i];
    v.active = false; // minimal: no envelope release
  }

  // APU reads from $F3
  readData(): number {
    const a = this.addr & 0x7f;
    // Hardware: 0x7F returns ENDX latch and clears it
    if (a === 0x7f) {
      const v = this.endxMask & 0xff;
      this.endxMask = 0;
      return v;
    }
    // Per-voice status mirrors (read-only): ENVX (0x08), OUTX (0x09)
    const off = a & 0x0f;
    if (off === 0x08 || off === 0x09) {
      const vi = (a >>> 4) & 0x07;
      const v = this.voices[vi];
      if (off === 0x08) {
        // ENVX range 0..127
        const envx = Math.max(0, Math.min(127, Math.round(v.env * 127)));
        return envx & 0x7f;
      } else {
        // OUTX is signed 8-bit; approximate from current sample after envelope
        const s = Math.max(-32768, Math.min(32767, Math.round((v.h0 | 0) * (v.env || 0))));
        const out8 = (s >> 8) & 0xff; // take high 8 bits
        return out8;
      }
    }
    return this.regs[a] & 0xff;
  }

  // Mix one sample (stereo), 16-bit ints
  mixSample(): [number, number] {
    // Mute shortcut
    if (this.mute) return [0, 0];

    let dryL = 0;
    let dryR = 0;
    let echoInL = 0;
    let echoInR = 0;

    const mvolL = (this.regs[0x0c] << 24) >> 24; // signed 8-bit
    const mvolR = (this.regs[0x1c] << 24) >> 24;
    const evolL = (this.regs[0x2c] << 24) >> 24; // signed 8-bit
    const evolR = (this.regs[0x3c] << 24) >> 24;
    const eon = this.eonMask & 0xff;

    const frameTraceVoices: any[] = this.traceMix ? [] : null as any;
    let tracedGlobals = false;

    for (let i = 0; i < 8; i++) {
      if (((this.voiceMask >>> i) & 1) === 0) continue;
      const v = this.voices[i];
      if (!v.active || !this.aram) continue;

      // Prime history with a few initial samples
      if (!v.primed) {
        // Decode 3 samples to fill h2,h1,h0
        this.decodeNext(v); this.decodeNext(v); this.decodeNext(v);
        v.primed = true;
        v.phase = 0;
      }

      // Advance phase by pitch/0x1000 per output sample
      const step = (v.pitch & 0x3fff) / 4096; // ~14-bit
      v.phase += step;
      while (v.phase >= 1.0) {
        this.decodeNext(v); // pushes into history h0,h1,h2,h3
        v.phase -= 1.0;
      }

      // Fraction between h1 and h0, where f=1 means exactly h0 (just after decode)
      const f = Math.max(0, Math.min(1, 1.0 - v.phase));
      // 4-tap Gaussian-like weights (approximate), normalized
      const g = (d: number) => Math.exp(-2.0 * d * d);
      const w3 = g(2 + f);
      const w2 = g(1 + f);
      const w1 = g(f);
      const w0 = g(1 - f);
      const wsum = w3 + w2 + w1 + w0 || 1;
      const sApprox = (v.h3 * w3 + v.h2 * w2 + v.h1 * w1 + v.h0 * w0) / wsum;
      let s = sApprox; // keep high precision here

      // Envelope
      const envVal = this.updateEnvelope(v);
      s = s * envVal;

      // Apply per-voice volumes (signed), keep as float until final clamp
      let volL = v.volL | 0;
      let volR = v.volR | 0;
      if (this.forcePanFramesLeft > 0 && this.forcePanVoice === i) {
        volL = 127; volR = 0;
      }
      const vl = (s * volL) / 128;
      const vr = (s * volR) / 128;

      if (frameTraceVoices) frameTraceVoices.push({ i, pitch: v.pitch|0, step, phase: v.phase, sApprox, env: envVal, s, volL: volL, volR: volR, vl, vr });

      dryL += vl;
      dryR += vr;
      if (eon & (1 << i)) { echoInL += vl; echoInR += vr; }
    }

    // Echo FIR filter of previous echo samples from ARAM
    let firL = 0, firR = 0;
    if (this.aram && this.echoFrames > 0) {
    for (let t = 0; t < 8; t++) {
      const coeff = (this.regs[(0x0f + (t << 4)) & 0x7f] << 24) >> 24; // signed 8-bit
      const idxFrame = (this.echoPosFrame - t + this.echoFrames) % this.echoFrames;
      const [eL, eR] = this.readEchoLRAtFrame(idxFrame);
      firL += (eL * coeff) / 128;
      firR += (eR * coeff) / 128;
    }
    }

    // Output = dry*MVOL + echo*EVOL
    let outL = ((dryL * mvolL) / 128) + ((firL * evolL) / 128);
    let outR = ((dryR * mvolR) / 128) + ((firR * evolR) / 128);

    // Write echo buffer: input + feedback*filtered
    const efb = (this.regs[0x0d] << 24) >> 24; // EFB feedback gain
    let wL = echoInL + ((firL * efb) / 128);
    let wR = echoInR + ((firR * efb) / 128);
    // Clamp write
    wL = Math.max(-32768, Math.min(32767, Math.round(wL)));
    wR = Math.max(-32768, Math.min(32767, Math.round(wR)));

    if (this.aram && !this.echoWriteDisable) {
      this.writeEchoLRAtFrame(this.echoPosFrame, wL, wR);
    }
    this.echoPosFrame = (this.echoPosFrame + 1) % Math.max(1, this.echoFrames);

    // Apply master mix gain then clamp to 16-bit final output
    outL *= this.mixGain;
    outR *= this.mixGain;
    const l = Math.max(-32768, Math.min(32767, Math.round(outL)));
    const r = Math.max(-32768, Math.min(32767, Math.round(outR)));

    this.debug = { dryL, dryR, echoInL, echoInR, firL, firR, outL, outR, mvolL, mvolR, evolL, evolR };

    if (this.traceMix && this.traceFrames.length < this.traceMaxFrames) {
      // On the very first frame, snapshot key DSP globals for context
      if (!tracedGlobals && this.traceFrames.length === 0) {
        const s8 = (x: number) => ((x << 24) >> 24);
        const r8 = (a: number) => this.regs[a & 0x7f] & 0xff;
        const globals = {
          FLG: r8(0x6c), KON: r8(0x4c), KOF: r8(0x5c),
          MVOLL: s8(r8(0x0c)), MVOLR: s8(r8(0x1c)), EVOLL: s8(r8(0x2c)), EVOLR: s8(r8(0x3c)),
          EON: r8(0x4d), ESA: r8(0x6d), EDL: r8(0x7d) & 0x0f, DIR: r8(0x5d)
        };
        this.traceFrames.push({ globals });
        tracedGlobals = true;
      }
      this.traceFrames.push({ dryL, dryR, outL, outR, voices: frameTraceVoices || [] });
      // Guard detection: count frames where left is exactly zero while right has any magnitude
      if (l === 0) this.guardLZero++; else this.guardLZero = 0;
      if (r !== 0) this.guardRNonZero++; else this.guardRNonZero = 0;
      if (this.guardLZero >= 64 && this.guardRNonZero >= 64) {
        this.traceFrames.push({ guard: 'left_pipeline_dead_suspected', at: this.traceFrames.length });
        // reset to avoid spamming
        this.guardLZero = 0; this.guardRNonZero = 0;
      }
    }

    // Decrement force-pan window if active
    if (this.forcePanFramesLeft > 0) this.forcePanFramesLeft--;

    return [l, r];
  }

  private readWord(addr: number): number {
    if (!this.aram) return 0;
    const a = addr & 0xffff;
    const lo = this.aram[a] & 0xff;
    const hi = this.aram[(a + 1) & 0xffff] & 0xff;
    return ((hi << 8) | lo) & 0xffff;
  }

  private readS16(addr: number): number {
    if (!this.aram) return 0;
    const a = addr & 0xffff;
    const lo = this.aram[a] & 0xff;
    const hi = this.aram[(a + 1) & 0xffff] & 0xff;
    return ((hi << 8) | lo) << 16 >> 16;
  }

  private writeS16(addr: number, value: number): void {
    if (!this.aram) return;
    let v = value | 0;
    if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
    const a = addr & 0xffff;
    this.aram[a] = v & 0xff;
    this.aram[(a + 1) & 0xffff] = (v >>> 8) & 0xff;
  }

  private readEchoLRAtFrame(frameIdx: number): [number, number] {
    if (!this.aram) return [0, 0];
    const base = (this.esaBase + ((frameIdx % Math.max(1, this.echoFrames)) * 4)) & 0xffff;
    const l = this.readS16(base);
    const r = this.readS16((base + 2) & 0xffff);
    return [l, r];
  }

  private writeEchoLRAtFrame(frameIdx: number, l: number, r: number): void {
    if (!this.aram) return;
    const base = (this.esaBase + ((frameIdx % Math.max(1, this.echoFrames)) * 4)) & 0xffff;
    this.writeS16(base, l | 0);
    this.writeS16((base + 2) & 0xffff, r | 0);
  }

  private updateEnvelope(v: Voice): number {
    // Returns scalar gain in range 0..1 applied to sample
    // ADSR enabled?
    const adsr = (v.adsr1 & 0x80) !== 0;
    if (adsr) {
      if (this.traceEnv && v.index === 0 && this.envTrace.length < 64) this.envTrace.push(`pre idx=${v.index} phase=${v.envPhase} env=${v.env.toFixed(6)} adsr1=${v.adsr1.toString(16)} adsr2=${v.adsr2.toString(16)}`);
      // Attack rate: bits 4..6 (0..15). Map to step per sample.
      const AR = (v.adsr1 >>> 4) & 0x0f;
      const DR = (v.adsr1) & 0x0f;
      const SL = (v.adsr2 >>> 5) & 0x07; // 0..7
      const SR = (v.adsr2) & 0x1f;       // 0..31
      const sustainLevel = SL / 7; // approx 0..1

      if (v.envPhase === 0) v.envPhase = 1; // 1=attack,2=decay,3=sustain

      if (v.envPhase === 1) {
        const step = (AR + 1) / 2048; // fast enough
        v.env += step;
        if (v.env >= 1.0) { v.env = 1.0; v.envPhase = 2; }
      } else if (v.envPhase === 2) {
        const step = (DR + 1) / 4096;
        v.env -= step;
        if (v.env <= sustainLevel) { v.env = sustainLevel; v.envPhase = 3; }
      } else {
        // sustain: approximate linear decay using SR
        const step = (SR + 1) / 8192;
        v.env -= step;
        if (v.env < 0) v.env = 0;
      }
    } else {
      // GAIN handling (approx). If direct mode (0x00..0x7f), set level directly.
      const g = v.gain & 0xff;
      if ((g & 0x80) === 0) {
        v.env = (g & 0x7f) / 127;
      } else {
        // Basic linear up/down depending on mode, using low 5 bits as rate
        const mode = (g >>> 5) & 0x07; // 4..7 meaningful here
        const rate = (g & 0x1f) + 1;
        const step = rate / 4096;
        if (mode >= 6) { // increase
          v.env += step;
          if (v.env > 1) v.env = 1;
        } else { // decrease
          v.env -= step;
          if (v.env < 0) v.env = 0;
        }
      }
    }
    if (v.env < 0) v.env = 0; if (v.env > 1) v.env = 1;
    if (this.traceEnv && v.index === 0 && this.envTrace.length < 128) this.envTrace.push(`post idx=${v.index} phase=${v.envPhase} env=${v.env.toFixed(6)}`);
    return v.env;
  }

  private decodeNext(v: Voice): number {
    if (!this.aram) return 0;

    if (v.samplesRemainingInBlock <= 0) {
      // Load new BRR block
      const header = this.aram[v.curAddr & 0xffff] & 0xff;
      v.curHeader = header;
      v.brrByteIndex = 1; // next byte after header
      v.samplesRemainingInBlock = 16;
      if (this.decodeTrace.length < this.decodeTraceMax) {
        const end = (header & 0x01) !== 0;  // BRR END flag is bit0
        const loop = (header & 0x02) !== 0; // BRR LOOP flag is bit1
        this.decodeTrace.push({ evt: 'hdr', addr: v.curAddr & 0xffff, hdr: header, end, loop });
      }
    }

    // Read next 4-bit nibble
    const byte = this.aram[(v.curAddr + v.brrByteIndex) & 0xffff] & 0xff;
    const nibbleIndex = 16 - v.samplesRemainingInBlock; // 0..15
    const hiNib = ((nibbleIndex & 1) === 0);
    let n4 = hiNib ? (byte >> 4) & 0x0f : byte & 0x0f;
    if (!hiNib) v.brrByteIndex++;
    if (n4 & 0x08) n4 = n4 - 16; // sign extend 4-bit -> -8..7

    // Shift (range) and base sample
    let range = (v.curHeader >>> 4) & 0x0f;
    if (range > 12) range = 12; // clamp
    let s = (n4 << 12) >> range;

    // Apply filter using two previous samples
    const f = (v.curHeader >>> 2) & 0x03;
    const s1 = v.prev1 | 0;
    const s2 = v.prev2 | 0;
    switch (f) {
      case 0: break;
      case 1: s += (s1 * 15) >> 4; break; // 15/16
      case 2: s += ((s1 * 61) >> 5) - ((s2 * 15) >> 4); break; // 61/32 - 15/16
      case 3: s += ((s1 * 115) >> 6) - ((s2 * 13) >> 4); break; // 115/64 - 13/16
    }

    // Clamp to 16-bit signed
    if (s > 32767) s = 32767; else if (s < -32768) s = -32768;

    // Update history
    v.prev2 = v.prev1;
    v.prev1 = s;

    v.samplesRemainingInBlock--;
    if (v.samplesRemainingInBlock <= 0) {
      // End of block: advance pointer
      const end = (v.curHeader & 0x01) !== 0;  // BRR END flag (bit0)
      const loop = (v.curHeader & 0x02) !== 0; // BRR LOOP flag (bit1)
      if (end) {
        // Latch ENDX bit for this voice
        this.endxMask |= (1 << (v.index & 7));
        // On END: hardware loops only if LOOP flag is set; otherwise the voice stops
        if (loop && v.loopAddr !== 0) {
          v.curAddr = v.loopAddr & 0xffff;
        } else {
          v.active = false; // stop
        }
      } else {
        v.curAddr = (v.curAddr + 9) & 0xffff; // 1 header + 8 data bytes
      }
      if (this.decodeTrace.length < this.decodeTraceMax) {
        this.decodeTrace.push({ evt: 'blk_end', next: v.curAddr & 0xffff, end, loop });
      }
    }

    // Push into interpolation history
    v.h3 = v.h2; v.h2 = v.h1; v.h1 = v.h0; v.h0 = s | 0;

    if (this.decodeTrace.length < this.decodeTraceMax) {
      this.decodeTrace.push({ evt: 's', addr: v.curAddr & 0xffff, bidx: v.brrByteIndex, nidx: nibbleIndex, n4, range, f, s, p1: v.prev1, p2: v.prev2 });
    }

    return s | 0;
  }
}

class Voice {
  // Static index
  public index: number;

  // Control
  public active = false;
  public srcn = 0;
  public volL = 0; // signed 8-bit
  public volR = 0; // signed 8-bit
  public pitch = 0; // 14-bit
  public adsr1 = 0; public adsr2 = 0; public gain = 0; // GAIN or ADSR

  // Sample pointers
  public startAddr = 0;
  public loopAddr = 0;
  public curAddr = 0;

  // BRR state
  public prev1 = 0;
  public prev2 = 0;
  public curHeader = 0;
  public samplesRemainingInBlock = 0;
  public brrByteIndex = 0;

  // Resampling state
  public phase = 0;
  public primed = false;
  // Interpolation history (most recent h0)
  public h0 = 0;
  public h1 = 0;
  public h2 = 0;
  public h3 = 0;

  // Envelope state
  public env = 0; // 0..1
  public envPhase = 0; // 0 unset, 1 attack, 2 decay, 3 sustain/hold

  public lastSample = 0;

  constructor(i: number) { this.index = i; }

  hardReset() {
    this.active = false; this.srcn = 0; this.volL = this.volR = 0; this.pitch = 0;
    this.adsr1 = this.adsr2 = this.gain = 0;
    this.startAddr = this.loopAddr = this.curAddr = 0;
    this.prev1 = this.prev2 = 0; this.curHeader = 0; this.samplesRemainingInBlock = 0; this.brrByteIndex = 0;
    this.phase = 0; this.primed = false;
    this.h0 = 0; this.h1 = 0; this.h2 = 0; this.h3 = 0;
    this.env = 0; this.envPhase = 0;
    this.lastSample = 0;
  }

  startKeyOn() {
    this.active = true;
    this.curAddr = this.startAddr & 0xffff;
    this.prev1 = 0; this.prev2 = 0; this.samplesRemainingInBlock = 0; this.brrByteIndex = 1; this.curHeader = 0;
    this.phase = 0; this.lastSample = 0;
    this.phase = 0; this.env = 0; this.envPhase = 1; // begin attack
    this.primed = false; this.h0 = this.h1 = this.h2 = this.h3 = 0;
  }
}
