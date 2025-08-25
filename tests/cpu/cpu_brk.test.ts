import { describe, it, expect } from 'vitest';
import { CPU65C816 } from '../../src/cpu/cpu65c816';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';

function setReset(bus: TestMemoryBus, addr: number) {
  bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
  bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}

describe('CPU BRK (simplified)', () => {
  it('jumps to $FFFE/$FFFF vector', () => {
    const bus = new TestMemoryBus();
    const start = 0x7000;
    setReset(bus, start);
    // Program: BRK
    bus.write8((0x00 << 16) | start, 0x00);
    // Set IRQ/BRK vector to $1234 at bank 0x00: $FFFE/$FFFF
    bus.write8((0x00 << 16) | 0xfffe, 0x34);
    bus.write8((0x00 << 16) | 0xffff, 0x12);

    const cpu = new CPU65C816(bus);
    cpu.reset();
    cpu.stepInstruction();
    expect(cpu.state.PC).toBe(0x1234);
  });
});

