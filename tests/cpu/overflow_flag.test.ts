import { describe, it, expect } from 'vitest';
import { CPU65C816, Flag } from '../../src/cpu/cpu65c816';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';

// Focused tests for ADC/SBC overflow flag (V) in 8-bit and 16-bit accumulator widths.
// These are self-contained and do not depend on external vector files.

function setupCpu(e: boolean, mFlag: boolean) {
  const bus = new TestMemoryBus();
  const cpu = new CPU65C816(bus);
  cpu.state.E = e; // Emulation mode forces 8-bit A/X/Y and D=0, etc.
  cpu.state.P = 0;
  if (mFlag) cpu.state.P |= Flag.M; // 1=8-bit, 0=16-bit accumulator
  cpu.state.PC = 0x8000;
  cpu.state.PBR = 0;
  cpu.state.DBR = 0;
  cpu.state.D = 0;
  cpu.state.S = cpu.state.E ? 0x01ff : 0x1fff;
  return { bus, cpu };
}

function loadImm(bus: TestMemoryBus, opcode: number, imm: number, bytes: 1 | 2) {
  const base = 0x008000;
  bus.write8(base, opcode);
  bus.write8(base + 1, imm & 0xff);
  if (bytes === 2) bus.write8(base + 2, (imm >>> 8) & 0xff);
}

// Helper to run one instruction
function run(cpu: CPU65C816) { cpu.stepInstruction(); }

// Cases for 8-bit ADC overflow flag behavior:
// Overflow occurs when adding two same-sign 7-bit values yields a different-sign result.
// Example: 0x50 + 0x50 = 0xA0 (no carry) sets V; 0xD0 + 0x90 = 0x60 clears V.

describe('CPU V flag: ADC/SBC overflow (focused)', () => {
  it('ADC 8-bit: sets V on signed overflow (0x50 + 0x50)', () => {
    const { bus, cpu } = setupCpu(true, true); // E=1, M=1 (8-bit)
    cpu.state.A = 0x50;
    cpu.state.P &= ~(Flag.N | Flag.V | Flag.Z | Flag.C);
    loadImm(bus, 0x69, 0x50, 1); // ADC #$50
    run(cpu);
    expect(cpu.state.A & 0xff).toBe(0xA0);
    expect((cpu.state.P & Flag.V) !== 0).toBe(true);
  });

  it('ADC 8-bit: clears V when no signed overflow (0x10 + 0x10)', () => {
    const { bus, cpu } = setupCpu(true, true);
    cpu.state.A = 0x10;
    cpu.state.P &= ~(Flag.N | Flag.V | Flag.Z | Flag.C);
    loadImm(bus, 0x69, 0x10, 1); // ADC #$10
    run(cpu);
    expect(cpu.state.A & 0xff).toBe(0x20);
    expect((cpu.state.P & Flag.V) !== 0).toBe(false);
  });

  it('ADC 16-bit: sets V on signed overflow (0x4000 + 0x4000)', () => {
    const { bus, cpu } = setupCpu(false, false); // E=0, M=0 (16-bit)
    cpu.state.A = 0x4000;
    cpu.state.P &= ~(Flag.N | Flag.V | Flag.Z | Flag.C);
    loadImm(bus, 0x69, 0x4000, 2); // ADC #$4000
    run(cpu);
    expect(cpu.state.A & 0xffff).toBe(0x8000);
    expect((cpu.state.P & Flag.V) !== 0).toBe(true);
  });

  it('SBC 8-bit: sets V on signed overflow (0x80 - 0x01 = 0x7F)', () => {
    const { bus, cpu } = setupCpu(true, true);
    cpu.state.A = 0x80;
    // Ensure carry is set before SBC (borrow uses inverted carry on 65xx)
    cpu.state.P |= Flag.C;
    cpu.state.P &= ~(Flag.N | Flag.V | Flag.Z);
    loadImm(bus, 0xE9, 0x01, 1); // SBC #$01
    run(cpu);
    expect(cpu.state.A & 0xff).toBe(0x7F);
    expect((cpu.state.P & Flag.V) !== 0).toBe(true);
  });

  it('SBC 16-bit: clears V when no signed overflow (0x0100 - 0x0001 = 0x00FF)', () => {
    const { bus, cpu } = setupCpu(false, false);
    cpu.state.A = 0x0100;
    cpu.state.P |= Flag.C;
    cpu.state.P &= ~(Flag.N | Flag.V | Flag.Z);
    loadImm(bus, 0xE9, 0x0001, 2); // SBC #$0001
    run(cpu);
    expect(cpu.state.A & 0xffff).toBe(0x00FF);
    expect((cpu.state.P & Flag.V) !== 0).toBe(false);
  });
});

