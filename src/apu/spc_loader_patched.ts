import { APUDevice } from './apu';
import { patchSpcWaitLoops } from './spc_patcher';

// Load SPC with wait loop patching for better playback
export function loadSpcIntoApuPatched(apu: APUDevice, buf: Buffer): void {
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
  
  // PATCH WAIT LOOPS before restoring state
  console.log('Patching wait loops...');
  const patchCount = patchSpcWaitLoops(apu.aram);
  console.log(`Patched ${patchCount} wait loops`);
  
  // Restore IO registers
  try {
    const f1 = buf[ramStart + 0xf1] & 0xff;
    const t0 = buf[ramStart + 0xfa] & 0xff;
    const t1 = buf[ramStart + 0xfb] & 0xff;
    const t2 = buf[ramStart + 0xfc] & 0xff;
    (apu as any).setIoFromSnapshot?.(f1, t0, t1, t2);
  } catch {
    // ignore if not available
  }
  
  // Load DSP regs
  const dspBase = 0x10100;
  const anyApu: any = apu as any;
  const dspWriteAddr = (i: number) => (anyApu.setDspAddr ? anyApu.setDspAddr(i) : anyApu['dsp']?.writeAddr?.(i));
  const dspWriteData = (v: number) => anyApu['dsp']?.writeData?.(v);
  
  let kof = buf[dspBase + 0x5c] & 0xff;
  let kon = buf[dspBase + 0x4c] & 0xff;
  
  for (let i = 0; i < 128; i++) {
    if (i === 0x4c || i === 0x5c) continue;
    dspWriteAddr(i);
    dspWriteData(buf[dspBase + i] & 0xff);
  }
  
  // Apply KOF then KON
  dspWriteAddr(0x5c); 
  dspWriteData(kof);
  dspWriteAddr(0x4c); 
  dspWriteData(kon);
  
  // Restore envelope states for active voices
  try {
    const voices = anyApu['dsp']?.['voices'];
    if (voices && Array.isArray(voices)) {
      for (let i = 0; i < 8; i++) {
        if (kon & (1 << i)) {
          const v = voices[i];
          if (v) {
            const envxAddr = (i << 4) | 0x08;
            const envx = buf[dspBase + envxAddr] & 0x7f;
            v.env = envx / 127;
            
            if (v.env === 0) {
              v.envPhase = 1; // attack
            } else if (v.env >= 0.95) {
              v.envPhase = 2; // decay
            } else {
              v.envPhase = 3; // sustain
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }
  
  // Clear FLG reset/mute
  const flgOrig = buf[dspBase + 0x6c] & 0xff;
  const flg = flgOrig & ~0xc0;
  dspWriteAddr(0x6c); 
  dspWriteData(flg);
  
  // CPU registers
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
    
    // If PC is in a wait loop, advance it
    const opcode = apu.aram[pc];
    if (opcode === 0x00) {
      // PC is at a NOP (our patch), advance past the patched area
      console.log(`Advancing PC from patched area 0x${pc.toString(16)}`);
      anyApu.smp.PC = (pc + 6) & 0xffff;
    }
  } catch {
    // ignore
  }
}
