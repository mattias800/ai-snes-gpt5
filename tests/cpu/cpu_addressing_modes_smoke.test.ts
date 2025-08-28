import { describe, it, expect } from 'vitest';
import { CPU65C816, Flag } from '../../src/cpu/cpu65c816';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';

function setupCpu8(): { bus: TestMemoryBus; cpu: CPU65C816 } {
  const bus = new TestMemoryBus();
  const cpu = new CPU65C816(bus);
  // Emulation: 8-bit A/X/Y, stack page 0x0100
  cpu.state.E = true;
  cpu.state.P = (cpu.state.P | Flag.M | Flag.X) & ~Flag.D;
  cpu.state.PBR = 0x00;
  cpu.state.DBR = 0x7e;
  cpu.state.D = 0x0100;
  cpu.state.S = 0x01ff;
  cpu.state.PC = 0x8000;
  return { bus, cpu };
}

function setupCpu16(): { bus: TestMemoryBus; cpu: CPU65C816 } {
  const bus = new TestMemoryBus();
  const cpu = new CPU65C816(bus);
  // Native: 16-bit A and 16-bit X/Y (clear M and X), decimal off
  cpu.state.E = false;
  cpu.state.P = (cpu.state.P & ~(Flag.M | Flag.X | Flag.D)) | 0x00;
  cpu.state.PBR = 0x00;
  cpu.state.DBR = 0x7e;
  cpu.state.D = 0x0100;
  cpu.state.S = 0x1fff;
  cpu.state.PC = 0x8000;
  return { bus, cpu };
}

function w8(bus: TestMemoryBus, a: number, v: number) { bus.write8(a & 0xffffff, v & 0xff); }

// Helpers to write program at $00:8000
function prog8(bus: TestMemoryBus, op: number, operand: number) {
  w8(bus, 0x008000, op);
  w8(bus, 0x008001, operand & 0xff);
}

function run(cpu: CPU65C816) { cpu.stepInstruction(); }

// Build (dp),Y pointer and target
function setIndirectY(bus: TestMemoryBus, cpu: CPU65C816, dp: number, base: number, bank = cpu.state.DBR) {
  const ptr = (cpu.state.D + (dp & 0xff)) & 0xffff;
  w8(bus, 0x000000 | ptr, base & 0xff);
  w8(bus, 0x000000 | ((ptr + 1) & 0xffff), (base >>> 8) & 0xff);
  return ((bank << 16) | base) >>> 0;
}

// Build (dp,X) pointer and target
function setIndirectX(bus: TestMemoryBus, cpu: CPU65C816, dp: number, target: number, x: number) {
  cpu.state.X = x & 0xffff;
  const effDp = (dp + (cpu.state.X & 0xff)) & 0xff;
  const ptr = (cpu.state.D + effDp) & 0xffff;
  w8(bus, 0x000000 | ptr, target & 0xff);
  w8(bus, 0x000000 | ((ptr + 1) & 0xffff), (target >>> 8) & 0xff);
  return ((cpu.state.DBR << 16) | (target & 0xffff)) >>> 0;
}

describe('CPU addressing modes smoke: (dp),Y and (dp,X) for ADC/AND/EOR/ORA (8-bit, 16-bit)', () => {
  it('ADC (dp),Y 8-bit adds memory at (D+dp)+Y in DBR bank', () => {
    const { bus, cpu } = setupCpu8();
    cpu.state.A = 0x10; cpu.state.Y = 0x01; cpu.state.P &= ~(Flag.N|Flag.V|Flag.Z|Flag.C);
    const dp = 0x20;
    const base = 0x1000; // pointer base
    const eff = setIndirectY(bus, cpu, dp, base);
    // Place value at base+Y
    w8(bus, eff + 1, 0x20);
    // ADC (dp),Y -> 0x71
    prog8(bus, 0x71, dp);
    run(cpu);
    expect(cpu.state.A & 0xff).toBe(0x30);
    expect((cpu.state.P & Flag.Z) !== 0).toBe(false);
  });

  it('ADC (dp),Y 16-bit adds 16-bit memory', () => {
    const { bus, cpu } = setupCpu16();
    cpu.state.A = 0x0010; cpu.state.Y = 0x0002; cpu.state.P &= ~(Flag.N|Flag.V|Flag.Z|Flag.C);
    const dp = 0x34; const base = 0x1230; const eff = setIndirectY(bus, cpu, dp, base);
    // Write 16-bit at base+Y
    const addr = eff + cpu.state.Y;
    w8(bus, addr, 0x34);
    w8(bus, addr + 1, 0x12);
    // ADC (dp),Y
    prog8(bus, 0x71, dp);
    run(cpu);
    expect(cpu.state.A & 0xffff).toBe(0x1244);
  });

  it('AND dp,X 8-bit masks accumulator with memory at (D+(dp+X)&FF)', () => {
    const { bus, cpu } = setupCpu8();
    cpu.state.A = 0xF0; cpu.state.P &= ~(Flag.N|Flag.V|Flag.Z|Flag.C);
    const dp = 0x10; const x = 0x05; const target = 0x2000;
    const eff = setIndirectX(bus, cpu, dp, target, x);
    w8(bus, eff, 0x3C);
    // AND (dp,X) opcode 0x21
    prog8(bus, 0x21, dp);
    run(cpu);
    expect(cpu.state.A & 0xff).toBe(0x30);
  });

  it('EOR (dp),Y 8-bit xors accumulator with memory at pointer+Y', () => {
    const { bus, cpu } = setupCpu8();
    cpu.state.A = 0xAA; cpu.state.Y = 0x03; cpu.state.P &= ~(Flag.N|Flag.V|Flag.Z|Flag.C);
    const dp = 0x40; const base = 0x0F00; const eff = setIndirectY(bus, cpu, dp, base);
    w8(bus, eff + 3, 0xFF);
    // EOR (dp),Y opcode 0x51
    prog8(bus, 0x51, dp);
    run(cpu);
    expect(cpu.state.A & 0xff).toBe(0x55);
  });

  it('ORA (dp),Y 16-bit ors accumulator with 16-bit memory at pointer+Y', () => {
    const { bus, cpu } = setupCpu16();
    cpu.state.A = 0x1200; cpu.state.Y = 0x0001; cpu.state.P &= ~(Flag.N|Flag.V|Flag.Z|Flag.C);
    const dp = 0x55; const base = 0x2340; const eff = setIndirectY(bus, cpu, dp, base);
    const addr = eff + 1;
    w8(bus, addr, 0xFE);
    w8(bus, addr + 1, 0x00);
    // ORA (dp),Y opcode 0x11
    prog8(bus, 0x11, dp);
    run(cpu);
    expect(cpu.state.A & 0xffff).toBe(0x12FE);
  });
});

