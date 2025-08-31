// Parser for bsnes-plus CPU trace lines into a normalized pre-instruction state.
// This is heuristic to accommodate variations in bsnes-plus text formatting.
//
// Supported forms (examples):
//   00:8000 A:01 X:00 Y:00 S:01FF D:0000 DB:00 PBR:00 P: nvMXdiZC
//   00/8000 A:0001 X:0000 Y:0000 SP:01FF DP:0000 DB:00 P=ff
//
// Normalized record:
//   { PBR, PC, A, X, Y, S, D, DBR, P }

export interface BsnesCpuTrace {
  PBR: number; PC: number; A?: number; X?: number; Y?: number; S?: number; D?: number; DBR?: number; P?: number;
}

function parseHex(str: string | undefined, def: number | undefined = undefined): number | undefined {
  if (!str) return def;
  const v = parseInt(str, 16);
  if (Number.isNaN(v)) return def;
  return v >>> 0;
}

function parseFlagsWord(s: string): number {
  // Accept hex like 'ff' or flags string containing letters n,v,m,x,d,i,z,c with uppercase meaning set
  if (/^[0-9a-fA-F]{2}$/.test(s)) return parseInt(s, 16) & 0xff;
  let p = 0;
  const set = (ch: string, bit: number) => { if (s.includes(ch) && s.indexOf(ch) !== s.lastIndexOf(ch)) {/* ignore */} };
  const has = (lower: string, upper: string) => {
    if (s.includes(upper)) return 1; // uppercase => set
    if (s.includes(lower) && !s.includes(lower.toUpperCase())) return 0; // lowercase => clear
    return -1; // unknown -> leave as 0
  };
  const map: [string,string,number][] = [
    ['c','C',0x01], ['z','Z',0x02], ['i','I',0x04], ['d','D',0x08],
    ['x','X',0x10], ['m','M',0x20], ['v','V',0x40], ['n','N',0x80],
  ];
  for (const [lo, up, bit] of map) { if (has(lo, up) === 1) p |= bit; }
  return p & 0xff;
}

export function parseBsnesLine(line: string): BsnesCpuTrace | null {
  const addr = line.match(/^\s*([0-9a-fA-F]{2})[:\/]([0-9a-fA-F]{4})/);
  if (!addr) return null;
  const PBR = parseInt(addr[1], 16) & 0xff;
  const PC = parseInt(addr[2], 16) & 0xffff;

  const get = (re: RegExp) => (line.match(re)?.[1]);
  const A = parseHex(get(/\bA:([0-9a-fA-F]{2,4})\b/));
  const X = parseHex(get(/\bX:([0-9a-fA-F]{2,4})\b/));
  const Y = parseHex(get(/\bY:([0-9a-fA-F]{2,4})\b/));
  // Support S or SP
  const S = parseHex(get(/\bS[P]?:([0-9a-fA-F]{2,4})\b/));
  // Support D or DP
  const D = parseHex(get(/\bD[P]?:([0-9a-fA-F]{2,4})\b/));
  const DBR = parseHex(get(/\bDB:?([0-9a-fA-F]{2})\b/)) ?? parseHex(get(/\bDBR:?([0-9a-fA-F]{2})\b/));

  let P: number | undefined;
  const pHex = get(/\bP[=:]\s*([0-9a-fA-F]{2})\b/);
  if (pHex) P = parseInt(pHex, 16) & 0xff; else {
    const pStr = get(/\bP[=:]\s*([nNvVmMxXdDiIzZcC\.]{2,8})/);
    if (pStr) P = parseFlagsWord(pStr);
  }

  return { PBR, PC, A, X, Y, S, D, DBR, P };
}

export function parseBsnesTraceFile(text: string): BsnesCpuTrace[] {
  const lines = text.split(/\r?\n/);
  const out: BsnesCpuTrace[] = [];
  for (const ln of lines) {
    const rec = parseBsnesLine(ln);
    if (rec) out.push(rec);
  }
  return out;
}

