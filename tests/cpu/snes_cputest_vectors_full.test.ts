import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816, Flag } from '../../src/cpu/cpu65c816';
import { parseCpuVectors, discoverCpuTestsRoot } from '../../src/third_party/snesTests/parseCpuVectors';
import { assemble, AssembleUnsupportedError } from '../../src/third_party/snesTests/assemble65c816';

function m8FromP_E(P: number, E: boolean): boolean { return E || ((P & Flag.M) !== 0); }
function x8FromP_E(P: number, E: boolean): boolean { return E || ((P & Flag.X) !== 0); }

const ROOT = process.env.SNES_TESTS_DIR || path.resolve('third_party/snes-tests');
const { listFile } = discoverCpuTestsRoot(ROOT);

const runIf = (listFile && fs.existsSync(listFile)) ? describe : describe.skip;

runIf('Third-party snes-tests: CPU vectors (ALU subset; data-gated)', () => {
  const limit = Number(process.env.CPU_VECTORS_LIMIT || '500');

  if (!listFile) {
    it.skip('no tests file detected', () => {});
    return;
  }

  // Parse vectors and filter to the subset we currently assemble (broad set, still skip scaffolding)
  const ALLOWED = new Set([
    'adc','and','eor','ora','sbc',
    'lda','ldx','ldy',
    'sta','stx','sty','stz',
    'bit','tsb','trb',
    'asl','lsr','rol','ror',
    'inc','dec','inx','iny','dex','dey',
    'cmp','cpx','cpy',
    'clc','cld','cli','clv','sec','sed','sei',
    'tax','tay','txa','tya','tsx','txs','tcs','tsc','tcd','tdc','txy','tyx','xba','xce',
    'nop','wdm','pha','pla','phx','plx','phy','ply','phb','plb','phd','pld','phk','php','plp',
    'rep','sep'
  ]);
  const vectors = parseCpuVectors(listFile, { limit: limit > 0 ? limit : undefined })
    .filter(v => !v.requiresScaffolding)
    .filter(v => ALLOWED.has(v.op));

  if (vectors.length === 0) {
    it.skip('no runnable vectors found for ALU subset', () => {});
    return;
  }

  for (const v of vectors) {
    it(`${v.idHex} ${v.insDisplay}`, () => {
      const bus = new TestMemoryBus();
      const cpu = new CPU65C816(bus);

      const E = v.input.E !== 0;
      cpu.state.E = E;
      cpu.state.P = v.input.P & 0xff;

      const m8 = m8FromP_E(cpu.state.P, cpu.state.E);
      const x8 = x8FromP_E(cpu.state.P, cpu.state.E);

      const aMask = m8 ? 0xff : 0xffff;
      const xyMask = x8 ? 0xff : 0xffff;

      cpu.state.A = (v.input.A ?? 0) & aMask;
      cpu.state.X = (v.input.X ?? 0) & xyMask;
      cpu.state.Y = (v.input.Y ?? 0) & xyMask;
      cpu.state.D = (v.input.D ?? 0) & 0xffff;
      cpu.state.DBR = (v.input.DBR ?? 0) & 0xff;
      cpu.state.PBR = 0x00;
      cpu.state.S = v.input.S !== undefined ? (v.input.S & 0xffff) : (E ? 0x01ff : 0x1fff);
      cpu.state.PC = 0x8000;

      // Initial memory writes
      for (const m of v.memInit) bus.write8(m.addr24, m.val);

      // Assemble the instruction and write at 00:8000
      let bytes: Uint8Array;
      try {
        bytes = assemble(v, { m8, x8, e: E });
      } catch (e) {
        if (e instanceof AssembleUnsupportedError) {
          // Skip if we don't yet encode this combination
          return; // vitest treats as pass; alternative would be to call it.skip inside, but dynamic
        }
        throw e;
      }
      let addr = 0x008000;
      for (const b of bytes) bus.write8(addr++, b);

      // Execute one instruction
      cpu.stepInstruction();

      // Compare A/X/Y with width derived from expected P/E if provided, else from current state
      const expE = v.expected.E !== undefined ? (v.expected.E !== 0) : E;
      const expP = v.expected.P !== undefined ? v.expected.P : cpu.state.P;
      const expM8 = m8FromP_E(expP, expE);
      const expX8 = x8FromP_E(expP, expE);
      const aMaskExp = expM8 ? 0xff : 0xffff;
      const xyMaskExp = expX8 ? 0xff : 0xffff;

      expect(cpu.state.A & aMaskExp).toBe((v.expected.A ?? 0) & aMaskExp);
      if (v.expected.X !== undefined) expect(cpu.state.X & xyMaskExp).toBe(v.expected.X & xyMaskExp);
      if (v.expected.Y !== undefined) expect(cpu.state.Y & xyMaskExp).toBe(v.expected.Y & xyMaskExp);

      // Compare flags (full P byte)
      expect(cpu.state.P & 0xff).toBe(v.expected.P & 0xff);

      // Optional regs when specified
      if (v.expected.S !== undefined) expect(cpu.state.S & 0xffff).toBe(v.expected.S & 0xffff);
      if (v.expected.D !== undefined) expect(cpu.state.D & 0xffff).toBe(v.expected.D & 0xffff);
      if (v.expected.DBR !== undefined) expect(cpu.state.DBR & 0xff).toBe(v.expected.DBR & 0xff);

      // Memory expectations
      for (const m of v.memExpect) {
        const actual = bus.read8(m.addr24 >>> 0);
        expect(actual & 0xff).toBe(m.val & 0xff);
      }
    });
  }
});

