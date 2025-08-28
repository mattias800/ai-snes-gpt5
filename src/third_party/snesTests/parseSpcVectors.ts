import * as fs from 'fs';

export interface SpcVectorMemInit { addr: number; val: number; }
export interface SpcVectorMemExpect { addr: number; val: number; }
export interface SpcVector {
  idHex: string;
  insText: string;
  input: { A: number; X: number; Y: number; P: number; SP?: number };
  expected: { A?: number; X?: number; Y?: number; P?: number; SP?: number };
  memInit: SpcVectorMemInit[];
  memExpect: SpcVectorMemExpect[];
}

function hexToInt(s: string): number { return parseInt(s, 16) >>> 0; }

export function parseSpcVectors(listFile: string, opts: { limit?: number } = {}): SpcVector[] {
  if (!fs.existsSync(listFile)) return [];
  const lines = fs.readFileSync(listFile, 'utf8').split(/\r?\n/);
  const out: SpcVector[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mHead = line.match(/^Test\s+(\w+):\s+(.+)$/i);
    if (!mHead) continue;
    const idHex = mHead[1].toLowerCase();
    const insText = mHead[2].trim();
    const inputLine = lines[i + 1] || '';
    const expectLine = lines[i + 2] || '';

    const mIn = inputLine.match(/Input:.*\bA=\$(\w+)\b.*\bX=\$(\w+)\b.*\bY=\$(\w+)\b.*\bP=\$(\w\w)\b(?:.*\bSP=\$(\w\w)\b)?/i);
    const mEx = expectLine.match(/Expected output:.*\bA=\$(\w+)\b.*\bX=\$(\w+)\b.*\bY=\$(\w+)\b.*\bP=\$(\w\w)\b(?:.*\bSP=\$(\w\w)\b)?/i);
    if (!mIn || !mEx) continue;

    const input = {
      A: hexToInt(mIn[1]) & 0xff,
      X: hexToInt(mIn[2]) & 0xff,
      Y: hexToInt(mIn[3]) & 0xff,
      P: hexToInt(mIn[4]) & 0xff,
      SP: mIn[5] ? (hexToInt(mIn[5]) & 0xff) : undefined
    };
    const expected = {
      A: hexToInt(mEx[1]) & 0xff,
      X: hexToInt(mEx[2]) & 0xff,
      Y: hexToInt(mEx[3]) & 0xff,
      P: hexToInt(mEx[4]) & 0xff,
      SP: mEx[5] ? (hexToInt(mEx[5]) & 0xff) : undefined
    };

    // Memory initializations and expectations
    const memInit: SpcVectorMemInit[] = [];
    const memExp: SpcVectorMemExpect[] = [];
    // Parse ( $xxxx )=$yy and ($xx)=$yy variants from Input line
    const reMem = /\(\$(\w{2,4})\)=\$(\w{2})/g;
    let mm: RegExpExecArray | null;
    while ((mm = reMem.exec(inputLine)) !== null) {
      const addr = hexToInt(mm[1]) & 0xffff;
      const val = hexToInt(mm[2]) & 0xff;
      memInit.push({ addr, val });
    }
    // Parse expectations in Expected output line (same format)
    while ((mm = reMem.exec(expectLine)) !== null) {
      const addr = hexToInt(mm[1]) & 0xffff;
      const val = hexToInt(mm[2]) & 0xff;
      memExp.push({ addr, val });
    }

    out.push({ idHex, insText, input, expected, memInit, memExpect: memExp });
    if (opts.limit && out.length >= opts.limit) break;
  }
  return out;
}
