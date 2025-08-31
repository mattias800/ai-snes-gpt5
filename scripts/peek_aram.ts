#!/usr/bin/env tsx
import * as fs from 'fs';
import { APUDevice } from '../src/apu/apu';
import { loadSpcIntoApu } from '../src/apu/spc_loader';

function rd(apu: any, addr: number): number { return apu.read8(addr & 0xffff) & 0xff; }

const spcPath = process.argv[2] || 'yoshi.spc';
if (!fs.existsSync(spcPath)) { console.error('missing spc'); process.exit(1); }
const apu: any = new APUDevice();
loadSpcIntoApu(apu, fs.readFileSync(spcPath));

function hex2(n:number){return (n&0xff).toString(16).padStart(2,'0');}
function hex4(n:number){return (n&0xffff).toString(16).padStart(4,'0');}

const lo = rd(apu, 0xffde);
const hi = rd(apu, 0xffdf);
console.log('vector_BRK_IRQ', { addr: (hi<<8)|lo, lo, hi });
for (let i=0xffc0;i<=0xffff;i+=2){ const L=rd(apu,i), H=rd(apu,i+1); console.log(hex4(i), hex4((H<<8)|L)); }
console.log('dp_f0_ff', Array.from({length:16},(_,k)=>({addr:hex4(0x00f0+k),val:rd(apu,0x00f0+k)})));

// Optional args: start length to dump ARAM bytes
const startArg = process.argv[3];
const lenArg = process.argv[4];
if (startArg && lenArg) {
  const start = parseInt(startArg, 16) | 0;
  const len = parseInt(lenArg, 10) | 0;
  const bytes: string[] = [];
  for (let i = 0; i < len; i++) bytes.push(hex2(apu.aram[(start + i) & 0xffff]));
  console.log(`dump @${hex4(start)} len=${len}: ${bytes.join(' ')}`);
}

