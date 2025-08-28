// Parser for third_party/snes-tests cputest/tests-*.txt files
import * as fs from 'fs';
import * as path from 'path';
import { AddressingMode, CpuVector, hexToInt } from './types';

function parseHeader(line: string): { idHex: string; id: number; insDisplay: string } | null {
  const m = line.match(/^Test\s+([0-9a-fA-F]+):\s+(.+)$/);
  if (!m) return null;
  const idHex = m[1].toLowerCase();
  const id = parseInt(idHex, 16) >>> 0;
  const insDisplay = m[2].trim();
  return { idHex, id, insDisplay };
}

function parseRegBlock(line: string): {
  regs: { A?: number; X?: number; Y?: number; P?: number; E?: number; S?: number; D?: number; DBR?: number };
  mem: { addr24: number; val: number }[];
} {
  // Example: "Input: A=$1234 X=$5678 Y=$9abc P=$FF E=0 S=$01FF DBR=$7E D=$0000 ($7EFFFF)=$12 ($7E0000)=$34"
  const regs: { [k: string]: number | undefined } = {};
  const mem: { addr24: number; val: number }[] = [];

  const r = (re: RegExp) => {
    const m = line.match(re);
    return m ? hexToInt(m[1]) : undefined;
  };

  regs.A = r(/\bA=\$(\w+)/i);
  regs.X = r(/\bX=\$(\w+)/i);
  regs.Y = r(/\bY=\$(\w+)/i);
  const P = r(/\bP=\$(\w\w)\b/i);
  if (P !== undefined) regs.P = P & 0xff;
  const E = (line.match(/\bE=(0|1)\b/)?.[1]);
  if (E !== undefined) regs.E = parseInt(E, 10);
  regs.S = r(/\bS=\$(\w+)/i);
  regs.D = r(/\bD=\$(\w+)/i);
  regs.DBR = r(/\bDBR=\$(\w+)/i);

  const memRe = /\(\$(\w{6})\)=\$(\w{2})/g;
  let mm: RegExpExecArray | null;
  while ((mm = memRe.exec(line)) !== null) {
    const addr24 = hexToInt(mm[1]) & 0xffffff;
    const val = hexToInt(mm[2]) & 0xff;
    mem.push({ addr24, val });
  }

  return { regs: regs as any, mem };
}

function normalizeOperand(ins: string): { mode: AddressingMode; operands: CpuVector['operands'] } | null {
  // Extract mnemonic and operand part
  const s = ins.trim();
  const semi = s.indexOf(';');
  const trimmed = semi >= 0 ? s.slice(0, semi).trim() : s;
  const parts = trimmed.split(/\s+/, 2);
  const operand = parts[1] || '';
  if (operand.length === 0) {
    // Implied instruction (no operand)
    return { mode: 'impl', operands: {} };
  }

  // Immediate #$nn or #$nnnn
  let m: RegExpMatchArray | null;
  m = operand.match(/^#\$(\w{2,4})$/i);
  if (m) return { mode: 'imm', operands: { imm: hexToInt(m[1]) } };

  // Accumulator: just 'a'
  if (/^a$/i.test(operand)) return { mode: 'accum', operands: {} };

  // DP / DP,X / DP,Y
  m = operand.match(/^\$(\w{2})(?:,(x|y))?$/i);
  if (m) {
    const dp = hexToInt(m[1]) & 0xff;
    const idx = (m[2] || '').toLowerCase();
    if (idx === 'x') return { mode: 'dpX', operands: { dp } };
    if (idx === 'y') return { mode: 'dpY', operands: { dp } };
    return { mode: 'dp', operands: { dp } };
  }

  // ABS / ABS,X / ABS,Y
  m = operand.match(/^\$(\w{4})(?:,(x|y))?$/i);
  if (m) {
    const abs = hexToInt(m[1]) & 0xffff;
    const idx = (m[2] || '').toLowerCase();
    if (idx === 'x') return { mode: 'absX', operands: { abs } };
    if (idx === 'y') return { mode: 'absY', operands: { abs } };
    return { mode: 'abs', operands: { abs } };
  }

  // LONG / LONG,X
  m = operand.match(/^\$(\w{6})(?:,x)?$/i);
  if (m) {
    const long = hexToInt(m[1]) & 0xffffff;
    if (/,x$/i.test(operand)) return { mode: 'longX', operands: { long } };
    return { mode: 'long', operands: { long } };
  }

  // (DP), (DP),Y, (DP,X)
  m = operand.match(/^\(\$(\w{2})\)(?:,y)?$/i); // (dp) and (dp),y
  if (m) {
    const dp = hexToInt(m[1]) & 0xff;
    if (/\),y$/i.test(operand)) return { mode: 'indY', operands: { dp } };
    return { mode: 'ind', operands: { dp } };
  }
  m = operand.match(/^\(\$(\w{2}),(x)\)$/i); // (dp,x)
  if (m) {
    const dp = hexToInt(m[1]) & 0xff;
    return { mode: 'indX', operands: { dp } };
  }

  // [DP] and [DP],Y
  m = operand.match(/^\[\$(\w{2})\](?:,y)?$/i);
  if (m) {
    const dp = hexToInt(m[1]) & 0xff;
    if (/\],y$/i.test(operand)) return { mode: 'longIndY', operands: { dp } };
    return { mode: 'longInd', operands: { dp } };
  }

  // $dp,s and ($dp,s),y
  m = operand.match(/^\$(\w{2}),s$/i);
  if (m) return { mode: 'sr', operands: { sr: hexToInt(m[1]) & 0xff } };
  m = operand.match(/^\(\$(\w{2}),s\),y$/i);
  if (m) return { mode: 'srY', operands: { sr: hexToInt(m[1]) & 0xff } };

  // Jump-only (we won’t execute these initially): jmp (abs), jmp (abs,x), jml [$abs]
  if (/^\(\$(\w{4})\)$/i.test(operand)) return { mode: 'indAbs', operands: { abs: hexToInt(RegExp.$1) & 0xffff } as any };
  if (/^\(\$(\w{4}),x\)$/i.test(operand)) return { mode: 'absXInd', operands: { abs: hexToInt(RegExp.$1) & 0xffff } as any };
  if (/^\[\$(\w{4})\]$/i.test(operand)) return { mode: 'longAbs', operands: { abs: hexToInt(RegExp.$1) & 0xffff } as any };

  // Branch rel8/rel16 — not executed initially; we’ll classify as rel to allow filtering
  if (/^(\+|\-)\d+$/i.test(operand)) return { mode: 'rel8', operands: {} };
  // Generic signed 16-bit immediate form like -$8000 (used by PER in insDisplay)
  let m2 = operand.match(/^([+-]?)(?:\$)?([0-9a-fA-F]{1,4})$/);
  if (m2) {
    const sign = m2[1] === '-' ? -1 : 1;
    const v = (hexToInt(m2[2]) & 0xffff) * sign;
    const imm16 = (v & 0xffff);
    return { mode: 'rel16', operands: { imm: imm16 } };
  }

  // No recognizable operand — treat as implied (unsupported by runner)
  return null;
}

export function parseCpuVectors(listFile: string, opts?: { limit?: number }): CpuVector[] {
  if (!fs.existsSync(listFile)) return [];
  const text = fs.readFileSync(listFile, 'utf8');
  const lines = text.split(/\r?\n/);

  const out: CpuVector[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = parseHeader(lines[i]);
    if (!h) continue;
    const input = lines[i + 1] || '';
    const expect = lines[i + 2] || '';
    const maybeExtra = (lines[i + 3] || '').trim();

    const { regs: inRegs, mem: memInit } = parseRegBlock(input);
    const { regs: exRegs, mem: memExpect } = parseRegBlock(expect);

    // Determine mnemonic & addressing mode from display
    const display = h.insDisplay;
    const op = (display.split(/\s+/)[0] || '').toLowerCase();
    const parsed = normalizeOperand(display);

    // Detect extra scaffolding note
    const requiresScaffolding = /Additional initialization or checks are performed/i.test(maybeExtra);
    const note = (/^Note:\s*(.*)$/i.exec(maybeExtra)?.[1]) || undefined;

    const mode: AddressingMode = parsed?.mode || 'imm';
    const operands = parsed?.operands || {};

    out.push({
      id: h.id,
      idHex: h.idHex,
      insDisplay: display,
      op,
      mode,
      operands,
      input: {
        A: inRegs.A ?? 0,
        X: inRegs.X,
        Y: inRegs.Y,
        P: inRegs.P ?? 0,
        E: inRegs.E ?? 1,
        S: inRegs.S,
        D: inRegs.D,
        DBR: inRegs.DBR,
      },
      memInit,
      expected: {
        A: exRegs.A,
        X: exRegs.X,
        Y: exRegs.Y,
        P: exRegs.P,
        E: exRegs.E,
        S: exRegs.S,
        D: exRegs.D,
        DBR: exRegs.DBR,
      },
      memExpect,
      requiresScaffolding,
      note,
    });

    i += 2; // advance to next block
    if (opts?.limit && out.length >= opts.limit) break;
  }

  return out;
}

export function discoverCpuTestsRoot(root: string): { listFile: string | null; mode: 'full' | 'basic' | null } {
  const cpuDir = path.join(root, 'cputest');
  const full = path.join(cpuDir, 'tests-full.txt');
  const basic = path.join(cpuDir, 'tests-basic.txt');
  if (fs.existsSync(full)) return { listFile: full, mode: 'full' };
  if (fs.existsSync(basic)) return { listFile: basic, mode: 'basic' };
  return { listFile: null, mode: null };
}

