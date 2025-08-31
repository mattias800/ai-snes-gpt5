import { describe, it, expect } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816, Flag } from '../../src/cpu/cpu65c816';

function setReset(bus: TestMemoryBus, addr: number) {
  bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
  bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}

function adc8_bcd_model(a: number, b: number, c: number) {
  // 8-bit packed BCD model
  const a0 = a & 0x0f;
  const a1 = (a >>> 4) & 0x0f;
  const b0 = b & 0x0f;
  const b1 = (b >>> 4) & 0x0f;
  let lo = a0 + b0 + (c ? 1 : 0);
  let carry0 = 0;
  if (lo > 9) { lo += 6; carry0 = 1; }
  lo &= 0x0f;
  let hi = a1 + b1 + carry0;
  let carry1 = 0;
  if (hi > 9) { hi += 6; carry1 = 1; }
  hi &= 0x0f;
  const res = ((hi << 4) | lo) & 0xff;
  // Overflow flag is computed from binary sum of a+b+c before BCD adjust per 65C816 behavior
  const rbin = (a & 0xff) + (b & 0xff) + (c ? 1 : 0);
  const V = ((~((a ^ b) & 0xff)) & ((a ^ rbin) & 0xff) & 0x80) !== 0 ? 1 : 0;
  const C = carry1 ? 1 : 0;
  const Z = res === 0 ? 1 : 0;
  const N = (res & 0x80) !== 0 ? 1 : 0;
  return { res, C, V, Z, N };
}

function sbc8_bcd_model(a: number, b: number, c: number) {
  // 8-bit packed BCD subtract model (borrow = 1 - c)
  const borrowIn = c ? 0 : 1;
  const a0 = a & 0x0f;
  const a1 = (a >>> 4) & 0x0f;
  const b0 = b & 0x0f;
  const b1 = (b >>> 4) & 0x0f;
  let lo = a0 - b0 - borrowIn;
  let borrow0 = 0;
  if (lo < 0) { lo -= 6; borrow0 = 1; }
  lo &= 0x0f;
  let hi = a1 - b1 - borrow0;
  let borrow1 = 0;
  if (hi < 0) { hi -= 6; borrow1 = 1; }
  hi &= 0x0f;
  const res = ((hi << 4) | lo) & 0xff;
  // Binary overflow check uses binary result before BCD adjust
  const diffBin = (a & 0xff) - (b & 0xff) - borrowIn;
  const resBin = diffBin & 0xff;
  const V = (((a ^ b) & 0x80) !== 0) && (((a ^ resBin) & 0x80) !== 0) ? 1 : 0;
  const C = borrow1 ? 0 : 1; // carry set if no borrow
  const Z = res === 0 ? 1 : 0;
  const N = (res & 0x80) !== 0 ? 1 : 0;
  return { res, C, V, Z, N };
}

describe('ALU exhaustive: 8-bit ADC/SBC (Decimal=1, BCD)', () => {
  it('ADC #imm (BCD) matches model for all 8-bit inputs', () => {
    const bus = new TestMemoryBus();
    const start = 0x6200;
    setReset(bus, start);
    let pc = start;
    const SED = 0xF8, SEC = 0x38, CLC = 0x18, LDA_IMM = 0xa9, ADC_IMM = 0x69;
    bus.write8((0x00<<16) | pc++, SED);          // set decimal
    bus.write8((0x00<<16) | pc++, CLC);          // will overwrite per-case
    bus.write8((0x00<<16) | pc++, LDA_IMM);
    bus.write8((0x00<<16) | pc++, 0x00);         // A placeholder
    bus.write8((0x00<<16) | pc++, ADC_IMM);
    bus.write8((0x00<<16) | pc++, 0x00);         // B placeholder

    const cpu = new CPU65C816(bus);
    cpu.reset();

    for (let a = 0; a < 256; a++) {
      for (let b = 0; b < 256; b++) {
        // Skip invalid BCD nibbles to keep meaningful domain
        if (((a & 0x0f) > 9) || (((a >>> 4) & 0x0f) > 9)) continue;
        if (((b & 0x0f) > 9) || (((b >>> 4) & 0x0f) > 9)) continue;
        for (let carryIn = 0; carryIn <= 1; carryIn++) {
          // Patch carry and immediates
          bus.write8((0x00<<16) | (start+1), carryIn ? SEC : CLC);
          bus.write8((0x00<<16) | (start+3), a);
          bus.write8((0x00<<16) | (start+5), b);

          cpu.state.PC = start & 0xffff;
          cpu.state.PBR = 0x00;

          cpu.stepInstruction(); // SED
          cpu.stepInstruction(); // SEC/CLC
          cpu.stepInstruction(); // LDA #
          cpu.stepInstruction(); // ADC #

          const m = adc8_bcd_model(a, b, carryIn);
          expect(cpu.state.A & 0xff).toBe(m.res);
          expect(((cpu.state.P & Flag.C) ? 1 : 0)).toBe(m.C);
          expect(((cpu.state.P & Flag.V) ? 1 : 0)).toBe(m.V);
          expect(((cpu.state.P & Flag.Z) ? 1 : 0)).toBe(m.Z);
          expect(((cpu.state.P & Flag.N) ? 1 : 0)).toBe(m.N);
        }
      }
    }
  }, 60_000);

  it('SBC #imm (BCD) matches model for all 8-bit inputs', () => {
    const bus = new TestMemoryBus();
    const start = 0x7200;
    setReset(bus, start);
    let pc = start;
    const SED = 0xF8, SEC = 0x38, CLC = 0x18, LDA_IMM = 0xa9, SBC_IMM = 0xe9;
    bus.write8((0x00<<16) | pc++, SED);          // set decimal
    bus.write8((0x00<<16) | pc++, CLC);          // will overwrite per-case
    bus.write8((0x00<<16) | pc++, LDA_IMM);
    bus.write8((0x00<<16) | pc++, 0x00);         // A placeholder
    bus.write8((0x00<<16) | pc++, SBC_IMM);
    bus.write8((0x00<<16) | pc++, 0x00);         // B placeholder

    const cpu = new CPU65C816(bus);
    cpu.reset();

    for (let a = 0; a < 256; a++) {
      for (let b = 0; b < 256; b++) {
        // Skip invalid packed BCD inputs
        if (((a & 0x0f) > 9) || (((a >>> 4) & 0x0f) > 9)) continue;
        if (((b & 0x0f) > 9) || (((b >>> 4) & 0x0f) > 9)) continue;
        for (let carryIn = 0; carryIn <= 1; carryIn++) {
          bus.write8((0x00<<16) | (start+1), carryIn ? SEC : CLC);
          bus.write8((0x00<<16) | (start+3), a);
          bus.write8((0x00<<16) | (start+5), b);

          cpu.state.PC = start & 0xffff;
          cpu.state.PBR = 0x00;

          cpu.stepInstruction(); // SED
          cpu.stepInstruction(); // SEC/CLC
          cpu.stepInstruction(); // LDA #
          cpu.stepInstruction(); // SBC #

          const m = sbc8_bcd_model(a, b, carryIn);
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

