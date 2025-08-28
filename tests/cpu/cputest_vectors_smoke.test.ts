import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CPU65C816, Flag } from '../../src/cpu/cpu65c816';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';

const ROOT = process.env.SNES_TESTS_DIR || path.resolve('third_party/snes-tests');
const CPU_TXT = path.join(ROOT, 'cputest', 'tests-basic.txt');

function hexToInt(s: string): number { return parseInt(s, 16) >>> 0; }

type Op = 'adc' | 'and' | 'eor' | 'ora' | 'sbc';

type Mode =
  | 'imm'
  | 'dp'
  | 'dpX'
  | 'ind'      // ($dp)
  | 'indY'     // ($dp),y
  | 'indX'     // ($dp,x)
  | 'longInd'  // [$dp]
  | 'longIndY' // [$dp],y
  | 'abs'      // $hhhh
  | 'absX'     // $hhhh,x
  | 'absY'     // $hhhh,y
  | 'long'     // $bbhhhh
  | 'longX'    // $bbhhhh,x
  | 'sr'       // $dp,s
  | 'srY'      // ($dp,s),y
  ;

interface Vector {
  op: Op;
  mode: Mode;
  imm?: number; // for imm
  dp?: number;  // for dp-like 8-bit operands
  abs?: number; // for 16-bit absolute
  long?: number; // for 24-bit long absolute
  sr?: number; // 8-bit stack relative
  inputA: number;
  inputP: number;
  inputE: number; // 0 or 1
  inputDBR?: number;
  inputD?: number;
  inputX?: number;
  inputY?: number;
  memInit: { addr24: number; val: number }[];
  expectedA: number;
  expectedP: number;
}

function parseVectors(limit = 500): Vector[] {
  if (!fs.existsSync(CPU_TXT)) return [];
  const lines = fs.readFileSync(CPU_TXT, 'utf8').split(/\r?\n/);
  const out: Vector[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let op: Op | null = null;
    let mode: Mode | null = null;
    let imm: number | undefined;
    let dp: number | undefined;
    let abs: number | undefined;
    let lon: number | undefined;
    let sr: number | undefined;

    const ADVANCED = process.env.CPU_VECTOR_ADVANCED_ADDR === '1';
    let m: RegExpMatchArray | null = null;

    // Immediate
    m = line.match(/^Test\s+\d+:\s+(adc|and|eor|ora|sbc)\s+#\$(\w{2,4})/i);
    if (m) { op = m[1].toLowerCase() as Op; mode = 'imm'; imm = hexToInt(m[2]); }

    // Simple DP
    if (!m) {
      m = line.match(/^Test\s+\d+:\s+(adc|and|eor|ora|sbc)\s+\$(\w{2})$/i);
      if (m) { op = m[1].toLowerCase() as Op; mode = 'dp'; dp = hexToInt(m[2]) & 0xff; }
    }

    if (!m && ADVANCED) {
      // Long indexed [$bbhhhh],x
      m = line.match(/^Test\s+\d+:\s+(adc|and|eor|ora|sbc)\s+\$(\w{6}),x$/i);
      if (m) { op = m[1].toLowerCase() as Op; mode = 'longX'; lon = hexToInt(m[2]) & 0xffffff; }
    }

    if (!m && ADVANCED) {
      // Long [$bbhhhh]
      m = line.match(/^Test\s+\d+:\s+(adc|and|eor|ora|sbc)\s+\$(\w{6})$/i);
      if (m) { op = m[1].toLowerCase() as Op; mode = 'long'; lon = hexToInt(m[2]) & 0xffffff; }
    }

    if (!m && ADVANCED) {
      // Absolute indexed $hhhh,x
      m = line.match(/^Test\s+\d+:\s+(adc|and|eor|ora|sbc)\s+\$(\w{4}),x$/i);
      if (m) { op = m[1].toLowerCase() as Op; mode = 'absX'; abs = hexToInt(m[2]) & 0xffff; }
    }

    if (!m && ADVANCED) {
      // Absolute indexed $hhhh,y
      m = line.match(/^Test\s+\d+:\s+(adc|and|eor|ora|sbc)\s+\$(\w{4}),y$/i);
      if (m) { op = m[1].toLowerCase() as Op; mode = 'absY'; abs = hexToInt(m[2]) & 0xffff; }
    }

    if (!m && ADVANCED) {
      // Absolute $hhhh
      m = line.match(/^Test\s+\d+:\s+(adc|and|eor|ora|sbc)\s+\$(\w{4})$/i);
      if (m) { op = m[1].toLowerCase() as Op; mode = 'abs'; abs = hexToInt(m[2]) & 0xffff; }
    }

    if (!m && ADVANCED) {
      // dp,x
      m = line.match(/^Test\s+\d+:\s+(adc|and|eor|ora|sbc)\s+\$(\w{2}),x$/i);
      if (m) { op = m[1].toLowerCase() as Op; mode = 'dpX'; dp = hexToInt(m[2]) & 0xff; }
    }

    if (!m && ADVANCED) {
      // ($dp,x)
      m = line.match(/^Test\s+\d+:\s+(adc|and|eor|ora|sbc)\s+\(\$(\w{2}),x\)$/i);
      if (m) { op = m[1].toLowerCase() as Op; mode = 'indX'; dp = hexToInt(m[2]) & 0xff; }
    }

    if (!m && ADVANCED) {
      // ($dp),y
      m = line.match(/^Test\s+\d+:\s+(adc|and|eor|ora|sbc)\s+\(\$(\w{2})\),y$/i);
      if (m) { op = m[1].toLowerCase() as Op; mode = 'indY'; dp = hexToInt(m[2]) & 0xff; }
    }

    if (!m && ADVANCED) {
      // ($dp)
      m = line.match(/^Test\s+\d+:\s+(adc|and|eor|ora|sbc)\s+\(\$(\w{2})\)$/i);
      if (m) { op = m[1].toLowerCase() as Op; mode = 'ind'; dp = hexToInt(m[2]) & 0xff; }
    }

    if (!m && ADVANCED) {
      // [$dp],y
      m = line.match(/^Test\s+\d+:\s+(adc|and|eor|ora|sbc)\s+\[\$(\w{2})\],y$/i);
      if (m) { op = m[1].toLowerCase() as Op; mode = 'longIndY'; dp = hexToInt(m[2]) & 0xff; }
    }

    if (!m && ADVANCED) {
      // [$dp]
      m = line.match(/^Test\s+\d+:\s+(adc|and|eor|ora|sbc)\s+\[\$(\w{2})\]$/i);
      if (m) { op = m[1].toLowerCase() as Op; mode = 'longInd'; dp = hexToInt(m[2]) & 0xff; }
    }

    if (!m && ADVANCED) {
      // $dp,s (stack relative)
      m = line.match(/^Test\s+\d+:\s+(adc|and|eor|ora|sbc)\s+\$(\w{2}),s$/i);
      if (m) { op = m[1].toLowerCase() as Op; mode = 'sr'; sr = hexToInt(m[2]) & 0xff; }
    }

    if (!m && ADVANCED) {
      // ($dp,s),y (stack relative indexed indirect)
      m = line.match(/^Test\s+\d+:\s+(adc|and|eor|ora|sbc)\s+\(\$(\w{2}),s\),y$/i);
      if (m) { op = m[1].toLowerCase() as Op; mode = 'srY'; sr = hexToInt(m[2]) & 0xff; }
    }

    if (!op || !mode) continue;

    if (!op || !mode) continue;

    const input = lines[i + 1] || '';
    const exp = lines[i + 2] || '';

    const mi = input.match(/Input:.*A=\$(\w+).*P=\$(\w\w).*E=(\d)/i);
    const me = exp.match(/Expected output:.*A=\$(\w+).*P=\$(\w\w)/i);
    if (!mi || !me) continue;

    const inputA = hexToInt(mi[1]);
    const inputP = hexToInt(mi[2]) & 0xff;
    const inputE = parseInt(mi[3], 10) | 0;
    const mX = input.match(/\bX=\$(\w+)/i);
    const mY = input.match(/\bY=\$(\w+)/i);
    const inputX = mX ? hexToInt(mX[1]) : undefined;
    const inputY = mY ? hexToInt(mY[1]) : undefined;
    const expectedA = hexToInt(me[1]);
    const expectedP = hexToInt(me[2]) & 0xff;

    // Optional DBR/D
    const mDBR = input.match(/DBR=\$(\w+)/i);
    const mD = input.match(/\bD=\$(\w+)/i);
    const inputDBR = mDBR ? hexToInt(mDBR[1]) & 0xff : undefined;
    const inputD = mD ? hexToInt(mD[1]) & 0xffff : undefined;

    // Memory initializations in Input line: ($xxxxxx)=$yy
    const memInit: { addr24: number; val: number }[] = [];
    const re = /\(\$(\w{6})\)=\$(\w{2})/g;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(input)) !== null) {
      const addr24 = hexToInt(mm[1]) & 0xffffff;
      const val = hexToInt(mm[2]) & 0xff;
      memInit.push({ addr24, val });
    }

    out.push({ op, mode, imm, dp, abs, long: lon, sr, inputA, inputP, inputE, inputDBR, inputD, inputX, inputY, memInit, expectedA, expectedP });
    if (out.length >= limit) break;
  }
  return out;
}

const vectors = parseVectors(500);
const runIf = vectors.length > 0 ? describe : describe.skip;

runIf('cputest vectors (ADC/AND/EOR/ORA/SBC; common addressing modes)', () => {
  for (const [idx, v] of vectors.entries()) {
    it(`${idx.toString().padStart(3, '0')}: ${v.op.toUpperCase()} ${
      v.mode === 'imm' ? '#$' + v.imm!.toString(16)
      : v.mode === 'dp' || v.mode === 'dpX' || v.mode === 'ind' || v.mode === 'indY' || v.mode === 'indX' || v.mode === 'longInd' || v.mode === 'longIndY' || v.mode === 'sr' || v.mode === 'srY'
        ? `${v.mode === 'ind' ? '($' : v.mode === 'indY' ? '($' : v.mode === 'indX' ? '($' : v.mode === 'longInd' ? '[$' : v.mode === 'longIndY' ? '[$' : ''}${(v.dp ?? v.sr)!.toString(16).padStart(2, '0')}${v.mode === 'ind' ? ')' : v.mode === 'indY' ? '),y' : v.mode === 'indX' ? ',x)' : v.mode === 'longInd' ? ']' : v.mode === 'longIndY' ? '],y' : v.mode === 'dpX' ? ',x' : v.mode === 'sr' ? ',s' : v.mode === 'srY' ? ',s),y' : ''}`
        : v.mode === 'abs' || v.mode === 'absX' || v.mode === 'absY'
          ? `$${v.abs!.toString(16).padStart(4, '0')}${v.mode === 'absX' ? ',x' : v.mode === 'absY' ? ',y' : ''}`
          : v.mode === 'long' || v.mode === 'longX'
            ? `$${v.long!.toString(16).padStart(6, '0')}${v.mode === 'longX' ? ',x' : ''}`
            : ''
    }`, () => {
      const bus = new TestMemoryBus();
      const cpu = new CPU65C816(bus);
      // Initialize CPU state
      cpu.state.E = v.inputE !== 0;
      cpu.state.P = v.inputP & 0xff;
      // Respect E forcing of width
      const aMask = (cpu.state.E || (cpu.state.P & Flag.M)) ? 0xff : 0xffff;
      cpu.state.A = v.inputA & aMask;
      // Set X/Y based on input and width
      if (v.inputX !== undefined) cpu.state.X = (cpu.state.E || (cpu.state.P & Flag.X)) ? (v.inputX & 0xff) : (v.inputX & 0xffff);
      else cpu.state.X = 0;
      if (v.inputY !== undefined) cpu.state.Y = (cpu.state.E || (cpu.state.P & Flag.X)) ? (v.inputY & 0xff) : (v.inputY & 0xffff);
      else cpu.state.Y = 0;
      cpu.state.PBR = 0x00; cpu.state.DBR = (v.inputDBR ?? 0) & 0xff;
      cpu.state.D = (v.inputD ?? 0x0000) & 0xffff;
      cpu.state.S = cpu.state.E ? 0x01ff : 0x1fff;
      cpu.state.PC = 0x8000;

      // Write memory initializations
      for (const m of v.memInit) bus.write8(m.addr24, m.val);

      // Assemble instruction at $00:8000
      const opcodeImm: Record<Op, number> = { adc: 0x69, and: 0x29, eor: 0x49, ora: 0x09, sbc: 0xE9 };
      const opcodeDp: Record<Op, number>  = { adc: 0x65, and: 0x25, eor: 0x45, ora: 0x05, sbc: 0xE5 };
      const opcodeDpX: Record<Op, number> = { adc: 0x75, and: 0x35, eor: 0x55, ora: 0x15, sbc: 0xF5 };
      const opcodeInd: Record<Op, number> = { adc: 0x72, and: 0x32, eor: 0x52, ora: 0x12, sbc: 0xF2 };
      const opcodeIndY: Record<Op, number>= { adc: 0x71, and: 0x31, eor: 0x51, ora: 0x11, sbc: 0xF1 };
      const opcodeIndX: Record<Op, number>= { adc: 0x61, and: 0x21, eor: 0x41, ora: 0x01, sbc: 0xE1 };
      const opcodeLongInd: Record<Op, number> = { adc: 0x67, and: 0x27, eor: 0x47, ora: 0x07, sbc: 0xE7 };
      const opcodeLongIndY: Record<Op, number>= { adc: 0x77, and: 0x37, eor: 0x57, ora: 0x17, sbc: 0xF7 };
      const opcodeAbs: Record<Op, number>   = { adc: 0x6D, and: 0x2D, eor: 0x4D, ora: 0x0D, sbc: 0xED };
      const opcodeAbsX: Record<Op, number>  = { adc: 0x7D, and: 0x3D, eor: 0x5D, ora: 0x1D, sbc: 0xFD };
      const opcodeAbsY: Record<Op, number>  = { adc: 0x79, and: 0x39, eor: 0x59, ora: 0x19, sbc: 0xF9 };
      const opcodeLong: Record<Op, number>  = { adc: 0x6F, and: 0x2F, eor: 0x4F, ora: 0x0F, sbc: 0xEF };
      const opcodeLongX: Record<Op, number> = { adc: 0x7F, and: 0x3F, eor: 0x5F, ora: 0x1F, sbc: 0xFF };
      const opcodeSr: Record<Op, number>    = { adc: 0x63, and: 0x23, eor: 0x43, ora: 0x03, sbc: 0xE3 };
      const opcodeSrY: Record<Op, number>   = { adc: 0x73, and: 0x33, eor: 0x53, ora: 0x13, sbc: 0xF3 };

      let addr = 0x008000;
      function w8(v: number) { bus.write8(addr++, v & 0xff); }

      if (v.mode === 'imm') {
        w8(opcodeImm[v.op]);
        const immSize = (cpu.state.E || (cpu.state.P & Flag.M)) ? 1 : 2;
        if (immSize === 1) {
          w8(v.imm! & 0xff);
        } else {
          w8(v.imm! & 0xff);
          w8((v.imm! >>> 8) & 0xff);
        }
      } else if (v.mode === 'dp') {
        w8(opcodeDp[v.op]); w8(v.dp!);
      } else if (v.mode === 'dpX') {
        w8(opcodeDpX[v.op]); w8(v.dp!);
      } else if (v.mode === 'ind') {
        w8(opcodeInd[v.op]); w8(v.dp!);
      } else if (v.mode === 'indY') {
        w8(opcodeIndY[v.op]); w8(v.dp!);
      } else if (v.mode === 'indX') {
        w8(opcodeIndX[v.op]); w8(v.dp!);
      } else if (v.mode === 'longInd') {
        w8(opcodeLongInd[v.op]); w8(v.dp!);
      } else if (v.mode === 'longIndY') {
        w8(opcodeLongIndY[v.op]); w8(v.dp!);
      } else if (v.mode === 'abs') {
        w8(opcodeAbs[v.op]); w8(v.abs! & 0xff); w8((v.abs! >>> 8) & 0xff);
      } else if (v.mode === 'absX') {
        w8(opcodeAbsX[v.op]); w8(v.abs! & 0xff); w8((v.abs! >>> 8) & 0xff);
      } else if (v.mode === 'absY') {
        w8(opcodeAbsY[v.op]); w8(v.abs! & 0xff); w8((v.abs! >>> 8) & 0xff);
      } else if (v.mode === 'long') {
        w8(opcodeLong[v.op]); w8(v.long! & 0xff); w8((v.long! >>> 8) & 0xff); w8((v.long! >>> 16) & 0xff);
      } else if (v.mode === 'longX') {
        w8(opcodeLongX[v.op]); w8(v.long! & 0xff); w8((v.long! >>> 8) & 0xff); w8((v.long! >>> 16) & 0xff);
      } else if (v.mode === 'sr') {
        w8(opcodeSr[v.op]); w8(v.sr!);
      } else if (v.mode === 'srY') {
        w8(opcodeSrY[v.op]); w8(v.sr!);
      }

      // Execute single instruction
      cpu.stepInstruction();

      const expectedMask = (cpu.state.E || (v.expectedP & Flag.M)) ? 0xff : 0xffff;
      const aNow = cpu.state.A & expectedMask;
      const aExp = v.expectedA & expectedMask;
      expect(aNow).toBe(aExp);

      // Compare flags N Z C only for now
      const maskFlags = Flag.N | Flag.Z | Flag.C;
      expect((cpu.state.P & maskFlags)).toBe(v.expectedP & maskFlags);
    });
  }
});
