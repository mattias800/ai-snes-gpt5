import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816, Flag } from '../../src/cpu/cpu65c816';

function setReset(bus: TestMemoryBus, addr: number) {
  bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
  bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}

describe('ALU randomized: 16-bit ADC/SBC (Decimal=0)', () => {
  it('ADC #imm16 matches model across random inputs', () => {
    const bus = new TestMemoryBus();
    const start = 0x6400;
    setReset(bus, start);
    let pc = start;
    const REP = 0xc2, IMM = 0x20; // REP #$20 -> clear M => 16-bit A (in native mode)
    const CLC = 0x18, SEC = 0x38, XCE = 0xfb, LDA_IMM16 = 0xa9, ADC_IMM = 0x69; // In 16-bit M=0, LDA # consumes 2 bytes

    // Program template: CLC; XCE; REP #$20; (SEC/CLC); LDA #$0000; ADC #$0000
    bus.write8((0x00<<16)|pc++, CLC);
    bus.write8((0x00<<16)|pc++, XCE);
    bus.write8((0x00<<16)|pc++, REP); bus.write8((0x00<<16)|pc++, IMM);
    bus.write8((0x00<<16)|pc++, CLC); // placeholder for carryIn
    bus.write8((0x00<<16)|pc++, LDA_IMM16); bus.write8((0x00<<16)|pc++, 0x00); bus.write8((0x00<<16)|pc++, 0x00);
    bus.write8((0x00<<16)|pc++, ADC_IMM);   bus.write8((0x00<<16)|pc++, 0x00); bus.write8((0x00<<16)|pc++, 0x00);

    const cpu = new CPU65C816(bus);
    cpu.reset();

    const model = (a: number, b: number, c: number) => {
      const r = (a & 0xffff) + (b & 0xffff) + (c ? 1 : 0);
      const res = r & 0xffff;
      const C = r > 0xffff ? 1 : 0;
      const V = ((~((a ^ b) & 0xffff)) & ((a ^ res) & 0xffff) & 0x8000) !== 0 ? 1 : 0;
      const Z = res === 0 ? 1 : 0;
      const N = (res & 0x8000) !== 0 ? 1 : 0;
      return { res, C, V, Z, N };
    };

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffff }),
        fc.integer({ min: 0, max: 0xffff }),
        fc.boolean(),
        (a, b, carryIn) => {
          // Patch carry and immediates
          // Carry placeholder sits at opcode index 4 now
          bus.write8((0x00<<16)|(start+4), carryIn ? SEC : CLC);
          // LDA immediate at indices 6 (lo), 7 (hi)
          bus.write8((0x00<<16)|(start+6), a & 0xff);
          bus.write8((0x00<<16)|(start+7), (a>>>8) & 0xff);
          // ADC immediate at indices 9 (lo), 10 (hi)
          bus.write8((0x00<<16)|(start+9), b & 0xff);
          bus.write8((0x00<<16)|(start+10), (b>>>8) & 0xff);

          cpu.state.PC = start & 0xffff; cpu.state.PBR = 0x00;
          cpu.state.P &= ~Flag.D; // decimal off

          cpu.stepInstruction(); // CLC (prep XCE)
          cpu.stepInstruction(); // XCE (enter native mode)
          cpu.stepInstruction(); // REP #$20 -> 16-bit A
          cpu.stepInstruction(); // SEC/CLC
          cpu.stepInstruction(); // LDA #16
          cpu.stepInstruction(); // ADC #16

          const m = model(a, b, carryIn ? 1 : 0);
          expect(cpu.state.A & 0xffff).toBe(m.res);
          expect(((cpu.state.P & Flag.C) ? 1 : 0)).toBe(m.C);
          expect(((cpu.state.P & Flag.V) ? 1 : 0)).toBe(m.V);
          expect(((cpu.state.P & Flag.Z) ? 1 : 0)).toBe(m.Z);
          expect(((cpu.state.P & Flag.N) ? 1 : 0)).toBe(m.N);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('SBC #imm16 matches model across random inputs', () => {
    const bus = new TestMemoryBus();
    const start = 0x7400;
    setReset(bus, start);
    let pc = start;
    const REP = 0xc2, IMM = 0x20; // M=0 (native mode only)
    const CLC = 0x18, SEC = 0x38, XCE = 0xfb, LDA_IMM16 = 0xa9, SBC_IMM = 0xe9;
    bus.write8((0x00<<16)|pc++, CLC);
    bus.write8((0x00<<16)|pc++, XCE);
    bus.write8((0x00<<16)|pc++, REP); bus.write8((0x00<<16)|pc++, IMM);
    bus.write8((0x00<<16)|pc++, CLC); // placeholder
    bus.write8((0x00<<16)|pc++, LDA_IMM16); bus.write8((0x00<<16)|pc++, 0x00); bus.write8((0x00<<16)|pc++, 0x00);
    bus.write8((0x00<<16)|pc++, SBC_IMM);   bus.write8((0x00<<16)|pc++, 0x00); bus.write8((0x00<<16)|pc++, 0x00);

    const cpu = new CPU65C816(bus);
    cpu.reset();

    const model = (a: number, b: number, c: number) => {
      const diff = (a & 0xffff) - (b & 0xffff) - (1 - (c ? 1 : 0));
      const res = diff & 0xffff;
      const C = diff >= 0 ? 1 : 0; // set if no borrow
      const V = (((a ^ b) & 0x8000) !== 0) && (((a ^ res) & 0x8000) !== 0) ? 1 : 0;
      const Z = res === 0 ? 1 : 0;
      const N = (res & 0x8000) !== 0 ? 1 : 0;
      return { res, C, V, Z, N };
    };

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffff }),
        fc.integer({ min: 0, max: 0xffff }),
        fc.boolean(),
        (a, b, carryIn) => {
          bus.write8((0x00<<16)|(start+4), carryIn ? SEC : CLC);
          bus.write8((0x00<<16)|(start+6), a & 0xff);
          bus.write8((0x00<<16)|(start+7), (a>>>8) & 0xff);
          bus.write8((0x00<<16)|(start+9), b & 0xff);
          bus.write8((0x00<<16)|(start+10), (b>>>8) & 0xff);

          cpu.state.PC = start & 0xffff; cpu.state.PBR = 0x00;
          cpu.state.P &= ~Flag.D;

          cpu.stepInstruction(); // CLC
          cpu.stepInstruction(); // XCE
          cpu.stepInstruction(); // REP #$20
          cpu.stepInstruction(); // SEC/CLC
          cpu.stepInstruction(); // LDA #16
          cpu.stepInstruction(); // SBC #16

          const m = model(a, b, carryIn ? 1 : 0);
          expect(cpu.state.A & 0xffff).toBe(m.res);
          expect(((cpu.state.P & Flag.C) ? 1 : 0)).toBe(m.C);
          expect(((cpu.state.P & Flag.V) ? 1 : 0)).toBe(m.V);
          expect(((cpu.state.P & Flag.Z) ? 1 : 0)).toBe(m.Z);
          expect(((cpu.state.P & Flag.N) ? 1 : 0)).toBe(m.N);
        }
      ),
      { numRuns: 200 }
    );
  });
});

