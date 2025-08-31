import { describe, it, expect } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816, Flag } from '../../src/cpu/cpu65c816';

function setReset(bus: TestMemoryBus, addr: number) {
  bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
  bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}

// Exhaustive 8-bit ADC/SBC in binary mode (Decimal=0)
// 256 * 256 * 2 carry-in values = 131,072 cases per op

describe('ALU exhaustive: 8-bit ADC/SBC (Decimal=0)', () => {
  it('ADC #imm matches model for all 8-bit inputs', () => {
    const bus = new TestMemoryBus();
    const start = 0x6000;
    setReset(bus, start);
    let pc = start;
    // Program stub: SEC/CLC; LDA #immA; ADC #immB; BRK
    // We will rewrite the immediate bytes and flags before each run.
    const SEC = 0x38, CLC = 0x18, LDA_IMM = 0xa9, ADC_IMM = 0x69, BRK = 0x00;
    bus.write8((0x00<<16) | pc++, CLC);          // placeholder, will overwrite
    bus.write8((0x00<<16) | pc++, LDA_IMM);
    bus.write8((0x00<<16) | pc++, 0x00);         // A imm placeholder
    bus.write8((0x00<<16) | pc++, ADC_IMM);
    bus.write8((0x00<<16) | pc++, 0x00);         // B imm placeholder
    bus.write8((0x00<<16) | pc++, BRK);

    const cpu = new CPU65C816(bus);
    cpu.reset();

    const model = (a: number, b: number, c: number) => {
      const r = (a & 0xff) + (b & 0xff) + (c ? 1 : 0);
      const res = r & 0xff;
      const C = r > 0xff ? 1 : 0;
      const V = ((~((a ^ b) & 0xff)) & ((a ^ res) & 0xff) & 0x80) !== 0 ? 1 : 0;
      const Z = res === 0 ? 1 : 0;
      const N = (res & 0x80) !== 0 ? 1 : 0;
      return { res, C, V, Z, N };
    };

    for (let a = 0; a < 256; a++) {
      for (let b = 0; b < 256; b++) {
        for (let carryIn = 0; carryIn <= 1; carryIn++) {
          // Patch program
          bus.write8((0x00<<16) | start, carryIn ? SEC : CLC);
          bus.write8((0x00<<16) | (start+2), a);
          bus.write8((0x00<<16) | (start+4), b);

          // Reset PC to start of program and clear Decimal flag
          cpu.state.PC = start & 0xffff;
          cpu.state.PBR = 0x00;
          cpu.state.P &= ~Flag.D;

          // Execute 4 instructions
          cpu.stepInstruction(); // SEC/CLC
          cpu.stepInstruction(); // LDA #
          cpu.stepInstruction(); // ADC #

          const m = model(a, b, carryIn);
          expect(cpu.state.A & 0xff).toBe(m.res);
          expect(((cpu.state.P & Flag.C) ? 1 : 0)).toBe(m.C);
          expect(((cpu.state.P & Flag.V) ? 1 : 0)).toBe(m.V);
          expect(((cpu.state.P & Flag.Z) ? 1 : 0)).toBe(m.Z);
          expect(((cpu.state.P & Flag.N) ? 1 : 0)).toBe(m.N);
        }
      }
    }
  }, 60_000);

  it('SBC #imm matches model for all 8-bit inputs', () => {
    const bus = new TestMemoryBus();
    const start = 0x7000;
    setReset(bus, start);
    let pc = start;
    const SEC = 0x38, CLC = 0x18, LDA_IMM = 0xa9, SBC_IMM = 0xe9;
    bus.write8((0x00<<16) | pc++, CLC);          // placeholder, will overwrite
    bus.write8((0x00<<16) | pc++, LDA_IMM);
    bus.write8((0x00<<16) | pc++, 0x00);         // A imm placeholder
    bus.write8((0x00<<16) | pc++, SBC_IMM);
    bus.write8((0x00<<16) | pc++, 0x00);         // B imm placeholder

    const cpu = new CPU65C816(bus);
    cpu.reset();

    const model = (a: number, b: number, c: number) => {
      const diff = (a & 0xff) - (b & 0xff) - (1 - (c ? 1 : 0));
      const res = diff & 0xff;
      const C = diff >= 0 ? 1 : 0; // set if no borrow
      const V = (((a ^ b) & 0x80) !== 0) && (((a ^ res) & 0x80) !== 0) ? 1 : 0;
      const Z = res === 0 ? 1 : 0;
      const N = (res & 0x80) !== 0 ? 1 : 0;
      return { res, C, V, Z, N };
    };

    for (let a = 0; a < 256; a++) {
      for (let b = 0; b < 256; b++) {
        for (let carryIn = 0; carryIn <= 1; carryIn++) {
          // Patch program
          bus.write8((0x00<<16) | start, carryIn ? SEC : CLC);
          bus.write8((0x00<<16) | (start+2), a);
          bus.write8((0x00<<16) | (start+4), b);

          // Reset PC to start and clear Decimal flag
          cpu.state.PC = start & 0xffff;
          cpu.state.PBR = 0x00;
          cpu.state.P &= ~Flag.D;

          cpu.stepInstruction(); // SEC/CLC
          cpu.stepInstruction(); // LDA #
          cpu.stepInstruction(); // SBC #

          const m = model(a, b, carryIn);
          expect(cpu.state.A & 0xff).toBe(m.res);
          expect(((cpu.state.P & Flag.C) ? 1 : 0)).toBe(m.C);
          expect(((cpu.state.P & Flag.V) ? 1 : 0)).toBe(m.V);
          expect(((cpu.state.P & Flag.Z) ? 1 : 0)).toBe(m.Z);
          expect(((cpu.state.P & Flag.N) ? 1 : 0)).toBe(m.N);
        }
      }
    }
  }, 60_000);
});

