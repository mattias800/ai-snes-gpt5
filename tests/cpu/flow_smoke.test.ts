import { describe, it, expect } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816 } from '../../src/cpu/cpu65c816';

function write8(bus: TestMemoryBus, addr24: number, v: number) {
  bus.write8(addr24 >>> 0, v & 0xff);
}

describe('Flow/system opcodes smoke', () => {
  it('WDM (0x42) consumes one operand byte and does nothing', () => {
    const bus = new TestMemoryBus();
    const cpu = new CPU65C816(bus);
    // Place WDM #$99 at 00:8000
    write8(bus, 0x008000, 0x42);
    write8(bus, 0x008001, 0x99);
    cpu.state.E = true; // emulation
    cpu.state.P = 0x34; // arbitrary P
    cpu.state.PBR = 0x00;
    cpu.state.PC = 0x8000;

    cpu.stepInstruction();

    expect(cpu.state.PBR).toBe(0x00);
    expect(cpu.state.PC).toBe(0x8002); // opcode + 1 operand
    expect(cpu.state.P & 0xff).toBe(0x34); // flags unchanged
  });

  it('JML [abs] (0xDC) long absolute indirect jump', () => {
    const bus = new TestMemoryBus();
    const cpu = new CPU65C816(bus);
    // Instruction at 00:8000: JML [$2000]
    write8(bus, 0x008000, 0xdc);
    write8(bus, 0x008001, 0x00); // low of $2000
    write8(bus, 0x008002, 0x20); // high of $2000
    // Pointer at 00:2000 -> bank=05, addr=1234
    write8(bus, 0x002000, 0x34);
    write8(bus, 0x002001, 0x12);
    write8(bus, 0x002002, 0x05);

    cpu.state.E = true;
    cpu.state.P = 0x00;
    cpu.state.PBR = 0x00;
    cpu.state.PC = 0x8000;

    cpu.stepInstruction();

    expect(cpu.state.PBR).toBe(0x05);
    expect(cpu.state.PC).toBe(0x1234);
  });
});
