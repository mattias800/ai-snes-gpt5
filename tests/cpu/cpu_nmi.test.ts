import { describe, it, expect } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816 } from '../../src/cpu/cpu65c816';

function setReset(bus: TestMemoryBus, addr: number) {
  bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
  bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}

describe('Minimal NMI handling', () => {
  it('CPU.nmi jumps to $FFFA vector in emulation mode', () => {
    const bus = new TestMemoryBus();
    const start = 0x8000;
    setReset(bus, start);
    // NMI vector (emulation mode) -> $4000
    bus.write8((0x00 << 16) | 0xfffa, 0x00);
    bus.write8((0x00 << 16) | 0xfffb, 0x40);

    const cpu = new CPU65C816(bus);
    cpu.reset();
    expect(cpu.state.PC).toBe(start);
    cpu.nmi();
    expect(cpu.state.PC).toBe(0x4000);
  });
});

