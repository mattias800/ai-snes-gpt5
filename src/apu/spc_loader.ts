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

