// Minimal 65C816 instruction assembler for a subset used in initial vector execution
// Focus: adc/and/eor/ora/sbc in common addressing modes, matching existing smoke test
import { AddressingMode, CpuVector } from './types';

export class AssembleUnsupportedError extends Error {
  constructor(public what: string) { super(`Unsupported encoding: ${what}`); }
}

type Mn = 'adc' | 'and' | 'eor' | 'ora' | 'sbc';

// opcode table for the subset (mnemonic.mode -> opcode)
const T: Record<`${Mn}.${AddressingMode}`, number | undefined> = {
  'adc.imm': 0x69, 'and.imm': 0x29, 'eor.imm': 0x49, 'ora.imm': 0x09, 'sbc.imm': 0xE9,
  'adc.dp': 0x65,  'and.dp': 0x25,  'eor.dp': 0x45,  'ora.dp': 0x05,  'sbc.dp': 0xE5,
  'adc.dpX': 0x75, 'and.dpX': 0x35, 'eor.dpX': 0x55, 'ora.dpX': 0x15, 'sbc.dpX': 0xF5,
  'adc.ind': 0x72, 'and.ind': 0x32, 'eor.ind': 0x52, 'ora.ind': 0x12, 'sbc.ind': 0xF2,
  'adc.indY': 0x71,'and.indY': 0x31,'eor.indY': 0x51,'ora.indY': 0x11,'sbc.indY': 0xF1,
  'adc.indX': 0x61,'and.indX': 0x21,'eor.indX': 0x41,'ora.indX': 0x01,'sbc.indX': 0xE1,
  'adc.longInd': 0x67, 'and.longInd': 0x27, 'eor.longInd': 0x47, 'ora.longInd': 0x07, 'sbc.longInd': 0xE7,
  'adc.longIndY': 0x77, 'and.longIndY': 0x37, 'eor.longIndY': 0x57, 'ora.longIndY': 0x17, 'sbc.longIndY': 0xF7,
  'adc.abs': 0x6D, 'and.abs': 0x2D, 'eor.abs': 0x4D, 'ora.abs': 0x0D, 'sbc.abs': 0xED,
  'adc.absX': 0x7D,'and.absX': 0x3D,'eor.absX': 0x5D,'ora.absX': 0x1D,'sbc.absX': 0xFD,
  'adc.absY': 0x79,'and.absY': 0x39,'eor.absY': 0x59,'ora.absY': 0x19,'sbc.absY': 0xF9,
  'adc.long': 0x6F,'and.long': 0x2F,'eor.long': 0x4F,'ora.long': 0x0F,'sbc.long': 0xEF,
  'adc.longX': 0x7F,'and.longX': 0x3F,'eor.longX': 0x5F,'ora.longX': 0x1F,'sbc.longX': 0xFF,
  'adc.sr': 0x63, 'and.sr': 0x23, 'eor.sr': 0x43, 'ora.sr': 0x03, 'sbc.sr': 0xE3,
  'adc.srY': 0x73,'and.srY': 0x33,'eor.srY': 0x53,'ora.srY': 0x13,'sbc.srY': 0xF3,
};

function w8(arr: number[], v: number) { arr.push(v & 0xff); }

export function assembleAluSubset(vec: CpuVector, cpuWidth: { m8: boolean; x8: boolean; e: boolean }): Uint8Array {
  const op = vec.op as Mn;
  const key = `${op}.${vec.mode}` as const;
  const opcode = T[key];
  if (opcode === undefined) {
    throw new AssembleUnsupportedError(key);
  }
  const out: number[] = [opcode & 0xff];
  switch (vec.mode) {
    case 'imm': {
      const val = vec.operands.imm ?? 0;
      const size = cpuWidth.m8 ? 1 : 2; // ALU ops depend on M
      w8(out, val);
      if (size === 2) w8(out, val >>> 8);
      break;
    }
    case 'dp': case 'dpX': case 'dpY': case 'ind': case 'indX': case 'indY': case 'longInd': case 'longIndY': case 'sr': case 'srY': {
      const dp = (vec.operands.dp ?? vec.operands.sr) ?? 0;
      w8(out, dp);
      break;
    }
    case 'abs': case 'absX': case 'absY': case 'indAbs': case 'absXInd': case 'longAbs': {
      const abs = vec.operands.abs ?? 0;
      w8(out, abs);
      w8(out, abs >>> 8);
      break;
    }
    case 'long': case 'longX': {
      const long = vec.operands.long ?? 0;
      w8(out, long);
      w8(out, long >>> 8);
      w8(out, long >>> 16);
      break;
    }
    default:
      // Branch/relative and accumulator-only not supported here
      throw new AssembleUnsupportedError(key);
  }
  return new Uint8Array(out);
}

