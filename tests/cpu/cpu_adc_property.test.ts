import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816, Flag } from '../../src/cpu/cpu65c816';

function setReset(bus: TestMemoryBus, addr: number) {
  bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
  bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}

function adc8_model(a: number, b: number, c: number) {
  const mask = 0xff;
  const sign = 0x80;
  const r = (a & mask) + (b & mask) + (c ? 1 : 0);
  const res = r & mask;
  const C = r > mask ? 1 : 0;
  const V = ((~((a ^ b) & mask)) & ((a ^ res) & mask) & sign) !== 0 ? 1 : 0;
  const Z = res === 0 ? 1 : 0;
  const N = (res & sign) !== 0 ? 1 : 0;
  return { res, C, V, Z, N };
}

describe('Property-based: ADC #imm (8-bit, decimal off)', () => {
  it('matches pure model across random inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.boolean(),
        (a, imm, carryIn) => {
          const bus = new TestMemoryBus();
          const start = 0x6000;
          setReset(bus, start);
          // program: (carry set/clear) LDA #a; (SEC?) ADC #imm
          let pc = start;
          bus.write8((0x00 << 16) | pc++, carryIn ? 0x38 : 0x18); // SEC/CLC
          bus.write8((0x00 << 16) | pc++, 0xa9); // LDA #
          bus.write8((0x00 << 16) | pc++, a & 0xff);
          bus.write8((0x00 << 16) | pc++, 0x69); // ADC #
          bus.write8((0x00 << 16) | pc++, imm & 0xff);

          const cpu = new CPU65C816(bus);
          cpu.reset();
          cpu.stepInstruction(); // SEC/CLC
          cpu.stepInstruction(); // LDA
          cpu.stepInstruction(); // ADC

          const model = adc8_model(a, imm, carryIn ? 1 : 0);
          expect(cpu.state.A & 0xff).toBe(model.res);
          expect(((cpu.state.P & Flag.C) !== 0) ? 1 : 0).toBe(model.C);
          expect(((cpu.state.P & Flag.V) !== 0) ? 1 : 0).toBe(model.V);
          expect(((cpu.state.P & Flag.Z) !== 0) ? 1 : 0).toBe(model.Z);
          expect(((cpu.state.P & Flag.N) !== 0) ? 1 : 0).toBe(model.N);
        }
      ),
      { numRuns: 200 }
    );
  });
});

