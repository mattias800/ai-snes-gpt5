import { describe, it, expect } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816, Flag } from '../../src/cpu/cpu65c816';

function setReset(bus: TestMemoryBus, addr: number) {
  bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
  bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}

function w(bus: TestMemoryBus, bank: number, addr: number, value: number) {
  bus.write8(((bank & 0xff) << 16) | (addr & 0xffff), value & 0xff);
}

describe('RTI round-trip', () => {
  it('RTI returns to original PC in emulation mode', () => {
    const bus = new TestMemoryBus();
    const start = 0x5000;
    setReset(bus, start);
    // Emulation IRQ/BRK vector -> $6000, place RTI there
    w(bus, 0x00, 0xfffe, 0x00);
    w(bus, 0x00, 0xffff, 0x60);
    w(bus, 0x00, 0x6000, 0x40); // RTI

    const cpu = new CPU65C816(bus);
    cpu.reset();
    const pcBefore = cpu.state.PC;
    cpu.irq(); // push P and PC, jump to $6000
    cpu.stepInstruction(); // RTI
    expect(cpu.state.PC).toBe(pcBefore);
    // In emulation, M and X must remain set
    expect((cpu.state.P & Flag.M) !== 0).toBe(true);
    expect((cpu.state.P & Flag.X) !== 0).toBe(true);
  });

  it('RTI restores P (including X) and PC in native mode', () => {
    const bus = new TestMemoryBus();
    const start = 0x5200;
    setReset(bus, start);
    // Program: XCE (native); SEP #$10 (X=1)
    w(bus, 0x00, start + 0, 0xfb);
    w(bus, 0x00, start + 1, 0xe2);
    w(bus, 0x00, start + 2, 0x10);
    // Native IRQ vector -> $6100 with RTI there
    w(bus, 0x00, 0xffee, 0x00);
    w(bus, 0x00, 0xffef, 0x61);
    w(bus, 0x00, 0x6100, 0x40); // RTI

    const cpu = new CPU65C816(bus);
    cpu.reset();
    cpu.stepInstruction(); // XCE -> native
    cpu.stepInstruction(); // SEP #$10 (X=1)
    const pcBefore = cpu.state.PC;
    const pBefore = cpu.state.P;
    cpu.irq(); // jumps to 0x6100
    cpu.stepInstruction(); // RTI
    expect(cpu.state.E).toBe(false);
    expect(cpu.state.PC).toBe(pcBefore);
    // X flag restored from pre-interrupt P
    expect((cpu.state.P & Flag.X) !== 0).toBe(((pBefore & Flag.X) !== 0));
    // If X=1, X/Y are 8-bit masked
    if ((pBefore & Flag.X) !== 0) {
      expect(cpu.state.X & 0xff00).toBe(0);
      expect(cpu.state.Y & 0xff00).toBe(0);
    }
  });
});

