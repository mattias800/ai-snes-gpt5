import { APUDevice } from './apu';

// Minimal SPC loader: ARAM (64 KiB) at 0x100, DSP regs (128B) at 0x10100,
// and CPU regs from header (best-effort offsets).
export function loadSpcIntoApu(apu: APUDevice, buf: Buffer): void {
  if (buf.length < 0x10180) throw new Error('SPC file too small');
  const sig = buf.slice(0, 33).toString('ascii');
  if (!sig.startsWith('SNES-SPC700')) {
    // continue anyway; many files still follow layout
  }
  // Copy ARAM
  const ramStart = 0x100;
  for (let i = 0; i < 0x10000; i++) {
    apu.aram[i] = buf[ramStart + i] & 0xff;
  }

  // Restore IO registers that aren't backed by ARAM memory in APUDevice
  try {
    const f1 = buf[ramStart + 0xf1] & 0xff; // control
    const t0 = buf[ramStart + 0xfa] & 0xff;
    const t1 = buf[ramStart + 0xfb] & 0xff;
    const t2 = buf[ramStart + 0xfc] & 0xff;
    (apu as any).setIoFromSnapshot?.(f1, t0, t1, t2);
  } catch {
    // ignore if not available
  }
  // Load DSP regs in two passes: first everything except KOF(0x5C)/KON(0x4C),
  // then apply KOF and KON to avoid keying on before voice params are set.
  const dspBase = 0x10100;
  const anyApu: any = apu as any;
  const dspWriteAddr = (i: number) => (anyApu.setDspAddr ? anyApu.setDspAddr(i) : anyApu['dsp']?.writeAddr?.(i));
  const dspWriteData = (v: number) => anyApu['dsp']?.writeData?.(v);

  let kof = buf[dspBase + 0x5c] & 0xff;
  let kon = buf[dspBase + 0x4c] & 0xff;

  for (let i = 0; i < 128; i++) {
    if (i === 0x4c || i === 0x5c) continue; // skip KON/KOF in first pass
    dspWriteAddr(i);
    dspWriteData(buf[dspBase + i] & 0xff);
  }
  // Apply KOF then KON as captured
  dspWriteAddr(0x5c); dspWriteData(kof);
  dspWriteAddr(0x4c); dspWriteData(kon);
  
  // For already-active voices, restore their envelope state from ENVX registers
  // This is a workaround since we can't restore the exact internal envelope state
  try {
    const voices = anyApu['dsp']?.['voices'];
    if (voices && Array.isArray(voices)) {
      for (let i = 0; i < 8; i++) {
        if (kon & (1 << i)) {
          const v = voices[i];
          if (v) {
            // Read the ENVX value from the SPC snapshot (voice reg offset 0x08)
            const envxAddr = (i << 4) | 0x08;
            const envx = buf[dspBase + envxAddr] & 0x7f;
            // Convert from 7-bit ENVX to 0..1 range
            v.env = envx / 127;
            
            // Set envelope phase based on ENVX value
            if (v.env === 0) {
              // If ENVX is 0, the voice was just keyed on - start attack phase
              v.envPhase = 1; // attack phase
            } else if (v.env >= 0.95) {
              // Near max, likely in attack or just finished attack
              v.envPhase = 2; // decay phase
            } else {
              // Middle values, likely in sustain
              v.envPhase = 3; // sustain phase
            }
          }
        }
      }
    }
  } catch {
    // ignore if private
  }

  // Ensure FLG reset/mute are cleared post-load so output is audible
  // Preserve other FLG bits from snapshot (e.g., echo write disable)
  const flgOrig = buf[dspBase + 0x6c] & 0xff;
  const flg = flgOrig & ~0xc0; // clear bit7 RESET and bit6 MUTE
  dspWriteAddr(0x6c); dspWriteData(flg);

  // Optional fallback: if IRQ/BRK vector is null (0xFFFF), install a RETI stub.
  // Disabled by default; enable via APU_REWRITE_NULL_IRQ=1 if needed.
  try {
    const rewrite = (typeof process !== 'undefined') && (process.env?.APU_REWRITE_NULL_IRQ === '1');
    if (rewrite) {
      const vLo = apu.aram[0xffde] & 0xff;
      const vHi = apu.aram[0xffdf] & 0xff;
      if ((vLo === 0xff) && (vHi === 0xff)) {
        apu.aram[0x0100] = 0x7f; // RETI
        apu.aram[0xffde] = 0x00;
        apu.aram[0xffdf] = 0x01;
      }
    }
  } catch {}

  // CPU registers (best-effort)
  try {
    const pc = (buf[0x26] << 8) | buf[0x25];
    const a = buf[0x27] & 0xff;
    const x = buf[0x28] & 0xff;
    const y = buf[0x29] & 0xff;
    const psw = buf[0x2a] & 0xff;
    const sp = buf[0x2b] & 0xff;
    anyApu.smp.PC = pc & 0xffff;
    anyApu.smp.A = a & 0xff;
    anyApu.smp.X = x & 0xff;
    anyApu.smp.Y = y & 0xff;
    anyApu.smp.PSW = psw & 0xff;
    anyApu.smp.SP = sp & 0xff;
  } catch {
    // ignore if private
  }
}

