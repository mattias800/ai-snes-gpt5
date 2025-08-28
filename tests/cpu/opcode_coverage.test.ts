import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Ensures every opcode 0x00..0xFF has a handler case in cpu65c816.ts.
// This is a lightweight static guard against regressions when refactoring the decoder.

describe('CPU opcode coverage (0x00..0xFF)', () => {
  it('all 256 opcodes have a case handler', () => {
    const cpuPath = path.resolve('src/cpu/cpu65c816.ts');
    const text = fs.readFileSync(cpuPath, 'utf8');
    const re = /case\s+0x([0-9a-fA-F]{2})\b/g;
    const seen = new Set<number>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const code = parseInt(m[1], 16) & 0xff;
      seen.add(code);
    }
    const missing: string[] = [];
    for (let i = 0; i < 256; i++) {
      if (!seen.has(i)) missing.push('0x' + i.toString(16).padStart(2, '0'));
    }
    expect(missing).toEqual([]);
  });
});
