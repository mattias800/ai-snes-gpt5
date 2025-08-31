#!/usr/bin/env tsx
import * as fs from 'fs';
import { APUDevice } from '../src/apu/apu';
import { loadSpcIntoApu } from '../src/apu/spc_loader';

const SMP_CLOCK_HZ = 1024_000;

function flagsToStr(psw: number): string {
  const N = (psw & 0x80) ? 'N' : 'n';
  const V = (psw & 0x40) ? 'V' : 'v';
  const P = (psw & 0x20) ? 'P' : 'p';
  const B = (psw & 0x10) ? 'B' : 'b';
  const H = (psw & 0x08) ? 'H' : 'h';
  const I = (psw & 0x04) ? 'I' : 'i';
  const Z = (psw & 0x02) ? 'Z' : 'z';
  const C = (psw & 0x01) ? 'C' : 'c';
  return `${N}${V}${P}${B}${H}${I}${Z}${C}`;
}

async function main() {
  const inPath = process.argv[2] || 'yoshi.spc';
  const ms = Number(process.argv[3] || '1000');
  const rate = 32000;
  if (!fs.existsSync(inPath)) throw new Error('SPC not found');
  const apu: any = new APUDevice();
  loadSpcIntoApu(apu, fs.readFileSync(inPath));
  const cps = Math.max(1, Math.round(SMP_CLOCK_HZ / rate));
  const frames = Math.max(1, Math.round((ms/1000) * rate));
  console.log('start', { PC: apu.smp.PC.toString(16), PSW: apu.smp.PSW.toString(16), flags: flagsToStr(apu.smp.PSW) });
  for (let i=0;i<frames;i++) { apu.step(cps); apu.mixSample(); if (i % (rate/10) === 0) {
    console.log('t', Math.round(i/rate*1000), { PC: apu.smp.PC.toString(16), PSW: apu.smp.PSW.toString(16), flags: flagsToStr(apu.smp.PSW), lastCycles: apu.smp.lastCycles });
  }}
  console.log('end', { PC: apu.smp.PC.toString(16), PSW: apu.smp.PSW.toString(16), flags: flagsToStr(apu.smp.PSW) });
}

main().catch(e=>{console.error(e);process.exit(1);});

