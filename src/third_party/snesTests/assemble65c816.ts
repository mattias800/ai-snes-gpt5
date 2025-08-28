// Expanded 65C816 instruction assembler for snes-tests vectors
import { AddressingMode, CpuVector } from './types';

export class AssembleUnsupportedError extends Error {
  constructor(public what: string) { super(`Unsupported encoding: ${what}`); }
}

// Supported mnemonics (expand as needed)
export type Mnemonic =
  | 'adc' | 'and' | 'eor' | 'ora' | 'sbc'
  | 'lda' | 'ldx' | 'ldy'
  | 'sta' | 'stx' | 'sty' | 'stz'
  | 'bit' | 'tsb' | 'trb'
  | 'asl' | 'lsr' | 'rol' | 'ror'
  | 'inc' | 'dec' | 'inx' | 'iny' | 'dex' | 'dey'
  | 'cmp' | 'cpx' | 'cpy'
  | 'clc' | 'cld' | 'cli' | 'clv' | 'sec' | 'sed' | 'sei'
  | 'tax' | 'tay' | 'txa' | 'tya' | 'tsx' | 'txs' | 'tcs' | 'tsc' | 'tcd' | 'tdc' | 'txy' | 'tyx' | 'xba' | 'xce'
  | 'nop' | 'wdm' | 'pha' | 'pla' | 'phx' | 'plx' | 'phy' | 'ply' | 'phb' | 'plb' | 'phd' | 'pld' | 'phk' | 'php' | 'plp'
  | 'rep' | 'sep'
  // Flow control / system
  | 'brk' | 'cop' | 'rti' | 'wai' | 'stp'
  | 'rts' | 'rtl'
  | 'jmp' | 'jsr' | 'jsl' | 'jml'
  | 'bra' | 'brl' | 'beq' | 'bne' | 'bcc' | 'bcs' | 'bpl' | 'bmi' | 'bvc' | 'bvs'
  | 'pea' | 'pei' | 'per';

// Table helpers
const memModes: AddressingMode[] = ['dp','dpX','dpY','abs','absX','absY','ind','indX','indY','longInd','longIndY','long','longX','sr','srY'];
const wordModes: AddressingMode[] = ['abs','absX','absY'];
const longModes: AddressingMode[] = ['long','longX'];
const dpLike: AddressingMode[] = ['dp','dpX','dpY'];

function w8(arr: number[], v: number) { arr.push(v & 0xff); }

function encodeOperand(out: number[], mode: AddressingMode, vec: CpuVector, width: 1|2|3|0 = 0) {
  switch (mode) {
    case 'imm': {
      if (width === 0) throw new Error('imm width required');
      const val = vec.operands.imm ?? 0;
      w8(out, val);
      if (width >= 2) w8(out, val >>> 8);
      if (width === 3) w8(out, val >>> 16);
      return;
    }
    case 'dp': case 'dpX': case 'dpY': case 'ind': case 'indX': case 'indY': case 'longInd': case 'longIndY': case 'sr': case 'srY': {
      const dv = (vec.operands.dp ?? vec.operands.sr) ?? 0;
      w8(out, dv);
      return;
    }
    case 'abs': case 'absX': case 'absY': case 'indAbs': case 'absXInd': case 'longAbs': {
      const a = vec.operands.abs ?? 0;
      w8(out, a);
      w8(out, a >>> 8);
      return;
    }
    case 'long': case 'longX': {
      const L = vec.operands.long ?? 0;
      w8(out, L);
      w8(out, L >>> 8);
      w8(out, L >>> 16);
      return;
    }
    case 'rel8': {
      const v = vec.operands.imm ?? 0;
      w8(out, v & 0xff);
      return;
    }
    case 'rel16': {
      const v = vec.operands.imm ?? 0;
      w8(out, v & 0xff);
      w8(out, (v >>> 8) & 0xff);
      return;
    }
    case 'accum': case 'impl':
      return; // no operand bytes
  }
}

// Per-mnemonic opcode maps (mode->opcode). Only include modes emitted by the generator.
const OP: Record<string, Partial<Record<AddressingMode, number>>> = {
  // ALU (A width)
  adc: { imm:0x69, dp:0x65, dpX:0x75, ind:0x72, indY:0x71, indX:0x61, longInd:0x67, longIndY:0x77, abs:0x6D, absX:0x7D, absY:0x79, long:0x6F, longX:0x7F, sr:0x63, srY:0x73 },
  and: { imm:0x29, dp:0x25, dpX:0x35, ind:0x32, indY:0x31, indX:0x21, longInd:0x27, longIndY:0x37, abs:0x2D, absX:0x3D, absY:0x39, long:0x2F, longX:0x3F, sr:0x23, srY:0x33 },
  eor: { imm:0x49, dp:0x45, dpX:0x55, ind:0x52, indY:0x51, indX:0x41, longInd:0x47, longIndY:0x57, abs:0x4D, absX:0x5D, absY:0x59, long:0x4F, longX:0x5F, sr:0x43, srY:0x53 },
  ora: { imm:0x09, dp:0x05, dpX:0x15, ind:0x12, indY:0x11, indX:0x01, longInd:0x07, longIndY:0x17, abs:0x0D, absX:0x1D, absY:0x19, long:0x0F, longX:0x1F, sr:0x03, srY:0x13 },
  sbc: { imm:0xE9, dp:0xE5, dpX:0xF5, ind:0xF2, indY:0xF1, indX:0xE1, longInd:0xE7, longIndY:0xF7, abs:0xED, absX:0xFD, absY:0xF9, long:0xEF, longX:0xFF, sr:0xE3, srY:0xF3 },

  // Loads
  lda: { imm:0xA9, dp:0xA5, dpX:0xB5, ind:0xB2, indY:0xB1, indX:0xA1, longInd:0xA7, longIndY:0xB7, abs:0xAD, absX:0xBD, absY:0xB9, long:0xAF, longX:0xBF, sr:0xA3, srY:0xB3 },
  ldx: { imm:0xA2, dp:0xA6, dpY:0xB6, abs:0xAE, absY:0xBE },
  ldy: { imm:0xA0, dp:0xA4, dpX:0xB4, abs:0xAC, absX:0xBC },

  // Stores
  sta: { dp:0x85, dpX:0x95, ind:0x92, indY:0x91, indX:0x81, longInd:0x87, longIndY:0x97, abs:0x8D, absX:0x9D, absY:0x99, long:0x8F, longX:0x9F, sr:0x83, srY:0x93 },
  stx: { dp:0x86, dpY:0x96, abs:0x8E },
  sty: { dp:0x84, dpX:0x94, abs:0x8C },
  stz: { dp:0x64, dpX:0x74, abs:0x9C, absX:0x9E },

  // BIT/TSB/TRB (A width where applicable)
  bit: { imm:0x89, dp:0x24, dpX:0x34, abs:0x2C, absX:0x3C },
  tsb: { dp:0x04, abs:0x0C },
  trb: { dp:0x14, abs:0x1C },

  // Shifts/rotates (accumulator or memory)
  asl: { accum:0x0A, dp:0x06, dpX:0x16, abs:0x0E, absX:0x1E },
  lsr: { accum:0x4A, dp:0x46, dpX:0x56, abs:0x4E, absX:0x5E },
  rol: { accum:0x2A, dp:0x26, dpX:0x36, abs:0x2E, absX:0x3E },
  ror: { accum:0x6A, dp:0x66, dpX:0x76, abs:0x6E, absX:0x7E },

  // INC/DEC
  inc: { accum:0x1A, dp:0xE6, dpX:0xF6, abs:0xEE, absX:0xFE },
  dec: { accum:0x3A, dp:0xC6, dpX:0xD6, abs:0xCE, absX:0xDE },
  inx: { impl:0xE8 },
  iny: { impl:0xC8 },
  dex: { impl:0xCA },
  dey: { impl:0x88 },

  // Compare
  cmp: { imm:0xC9, dp:0xC5, dpX:0xD5, ind:0xD2, indY:0xD1, indX:0xC1, longInd:0xC7, longIndY:0xD7, abs:0xCD, absX:0xDD, absY:0xD9, long:0xCF, longX:0xDF, sr:0xC3, srY:0xD3 },
  cpx: { imm:0xE0, dp:0xE4, abs:0xEC },
  cpy: { imm:0xC0, dp:0xC4, abs:0xCC },

  // Flag ops
  clc: { impl:0x18 }, cld: { impl:0xD8 }, cli: { impl:0x58 }, clv: { impl:0xB8 },
  sec: { impl:0x38 }, sed: { impl:0xF8 }, sei: { impl:0x78 },

  // Transfers
  tax: { impl:0xAA }, tay: { impl:0xA8 }, txa: { impl:0x8A }, tya: { impl:0x98 },
  tsx: { impl:0xBA }, txs: { impl:0x9A }, tcs: { impl:0x1B }, tsc: { impl:0x3B },
  tcd: { impl:0x5B }, tdc: { impl:0x7B }, txy: { impl:0x9B }, tyx: { impl:0xBB },
  xba: { impl:0xEB }, xce: { impl:0xFB },

  // Misc
  nop: { impl:0xEA }, wdm: { imm:0x42 },

  // Stack
  pha: { impl:0x48 }, pla: { impl:0x68 },
  phx: { impl:0xDA }, plx: { impl:0xFA },
  phy: { impl:0x5A }, ply: { impl:0x7A },
  phb: { impl:0x8B }, plb: { impl:0xAB },
  phd: { impl:0x0B }, pld: { impl:0x2B },
  phk: { impl:0x4B }, php: { impl:0x08 }, plp: { impl:0x28 },

  // REP/SEP
  rep: { imm:0xC2 }, sep: { imm:0xE2 },

  // Flow/system
  brk: { impl:0x00 }, cop: { impl:0x02 }, rti: { impl:0x40 }, wai: { impl:0xCB }, stp: { impl:0xDB },
  rts: { impl:0x60 }, rtl: { impl:0x6B },

  // Jumps and calls
  jmp: { abs:0x4C, indAbs:0x6C, absXInd:0x7C },
  jsr: { abs:0x20, absXInd:0xFC },
  jsl: { long:0x22 },
  jml: { long:0x5C, longAbs:0xDC },

  // Branches
  bra: { rel8:0x80 }, brl: { rel16:0x82 },
  beq: { rel8:0xF0 }, bne: { rel8:0xD0 },
  bcc: { rel8:0x90 }, bcs: { rel8:0xB0 },
  bpl: { rel8:0x10 }, bmi: { rel8:0x30 },
  bvc: { rel8:0x50 }, bvs: { rel8:0x70 },

  // PEA/PEI/PER
  pea: { abs:0xF4, imm:0xF4 },
  pei: { ind:0xD4 },
  per: { rel16:0x62 },
};

export function assemble(vec: CpuVector, cpuWidth: { m8: boolean; x8: boolean; e: boolean }): Uint8Array {
  const op = (vec.op || '').toLowerCase();
  const mm = OP[op];
  if (!mm) throw new AssembleUnsupportedError(`${op}`);
  const opc = mm[vec.mode];
  if (opc === undefined) throw new AssembleUnsupportedError(`${op}.${vec.mode}`);
  const out: number[] = [opc & 0xff];

  // Determine operand width for imm where needed
  let width: 1|2|3|0 = 0;
  if (vec.mode === 'imm') {
    // For opcodes where operand size depends on M (accumulator) or X (index), follow CPU flags
    if (['adc','and','eor','ora','sbc','lda','bit','cmp'].includes(op)) width = cpuWidth.m8 ? 1 : 2;
    else if (['ldx','ldy','cpx','cpy'].includes(op)) width = cpuWidth.x8 ? 1 : 2;
    else if (['rep','sep','wdm'].includes(op)) width = 1;
    else if (['pea'].includes(op)) width = 2; // PEA uses a 16-bit immediate (vector may encode as #$ or $)
    else width = 1; // default safe
  } else if (vec.mode === 'long') width = 3;

  encodeOperand(out, vec.mode, vec, width);
  return new Uint8Array(out);
}

