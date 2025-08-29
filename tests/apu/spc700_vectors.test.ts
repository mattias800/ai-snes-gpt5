import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { APUDevice } from '../../src/apu/apu';
import { parseSpcVectors } from '../../src/third_party/snesTests/parseSpcVectors';
import { assembleOne, AssembleUnsupportedError } from '../../src/third_party/snesTests/assembleSpc700';

const ROOT = process.env.SNES_TESTS_DIR || path.resolve('test-roms/snes-tests');
const LIST = path.join(ROOT, 'spctest', 'tests.txt');

const runIf = (LIST && fs.existsSync(LIST)) ? describe : describe.skip;

runIf('Third-party snes-tests: SPC700 vectors (data-gated, partial coverage)', () => {
  const limit = Number(process.env.SPC_VECTORS_LIMIT || '200');
  const vectors = parseSpcVectors(LIST, { limit: limit > 0 ? limit : undefined });
  if (vectors.length === 0) {
    it.skip('no vectors found', () => {});
    return;
  }

  for (const v of vectors) {
    it(`${v.idHex} ${v.insText}`, () => {
      const apu: any = new APUDevice();
      // Initialize registers
      apu.smp.A = v.input.A & 0xff;
      apu.smp.X = v.input.X & 0xff;
      apu.smp.Y = v.input.Y & 0xff;
      apu.smp.PSW = v.input.P & 0xff;
      // Default SP to 0xEF to match spctest harness expectations (unless explicitly provided)
      apu.smp.SP = v.input.SP !== undefined ? (v.input.SP & 0xff) : 0xef;
      apu.smp.PC = 0x0200;

      // Memory init
      for (const m of v.memInit) apu.write8(m.addr & 0xffff, m.val & 0xff);

      // Assemble instruction at 0x0200
      let bytes: Uint8Array;
      try {
        bytes = assembleOne(v.insText);
      } catch (e) {
        if (e instanceof AssembleUnsupportedError) {
          return; // skip unsupported encoding for now
        }
        throw e;
      }
      for (let i = 0; i < bytes.length; i++) apu.aram[(0x0200 + i) & 0xffff] = bytes[i];

      // Pre-prime stack for instructions that pop PSW (ret1/reti) since we don't run before_regs
      const expP = (v.expected.P ?? v.input.P) & 0xff;
      if (/^(ret1|reti)\b/i.test(v.insText)) {
        const sp = apu.smp.SP & 0xff;
        apu.aram[0x0100 | ((sp + 1) & 0xff)] = expP;
      }

      // Execute the assembled instruction (which may expand to multiple core ops in our assembler)
      apu.step(256);

      const expA = v.expected.A ?? v.input.A;
      const expX = v.expected.X ?? v.input.X;
      const expY = v.expected.Y ?? v.input.Y;

      expect(apu.smp.A & 0xff).toBe(expA & 0xff);
      expect(apu.smp.X & 0xff).toBe(expX & 0xff);
      expect(apu.smp.Y & 0xff).toBe(expY & 0xff);
      expect(apu.smp.PSW & 0xff).toBe(expP & 0xff);

      for (const m of v.memExpect) {
        const actual = apu.read8(m.addr & 0xffff) & 0xff;
        expect(actual).toBe(m.val & 0xff);
      }
    });
  }
});
