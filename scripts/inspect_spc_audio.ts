#!/usr/bin/env tsx
import * as fs from 'fs';
import { APUDevice } from '../src/apu/apu';
import { loadSpcIntoApu } from '../src/apu/spc_loader';

function s8(x: number) { return (x << 24) >> 24; }
function u8(x: number) { return x & 0xff; }

async function main() {
  const spcPath = process.argv[2] || 'yoshi.spc';
  if (!fs.existsSync(spcPath)) throw new Error('SPC not found: ' + spcPath);
  const apu = new APUDevice();
  const buf = fs.readFileSync(spcPath);
  loadSpcIntoApu(apu, buf);
  const anyApu: any = apu as any;
  const regs: Uint8Array = anyApu['dsp']?.['regs'];
  if (!regs) throw new Error('DSP regs not accessible');
  const r = (a: number) => u8(regs[a & 0x7f]);

  const info = {
    FLG: r(0x6c).toString(16),
    MVOLL: s8(r(0x0c)), MVOLR: s8(r(0x1c)),
    EVOLL: s8(r(0x2c)), EVOLR: s8(r(0x3c)),
    EON: r(0x4d).toString(16),
    DIR: r(0x5d), ESA: r(0x6d), EDL: r(0x7d) & 0x0f,
  };
  console.log('GLOBAL', info);

  for (let v = 0; v < 8; v++) {
    const base = v << 4;
    const vl = s8(r(base + 0x00));
    const vr = s8(r(base + 0x01));
    const pitch = ((r(base + 0x03) & 0x3f) << 8) | r(base + 0x02);
    const srcn = r(base + 0x04);
    const adsr1 = r(base + 0x05);
    const adsr2 = r(base + 0x06);
    const gain = r(base + 0x07);
    console.log(`V${v}`, { SRCN: srcn, PITCH: pitch, VL: vl, VR: vr, ADSR1: adsr1.toString(16), ADSR2: adsr2.toString(16), GAIN: gain.toString(16) });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

