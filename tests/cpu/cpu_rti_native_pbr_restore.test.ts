import { describe, it, expect } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816 } from '../../src/cpu/cpu65c816';

function setReset(bus: TestMemoryBus, addr: number) {
  bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
  bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}

function w(bus: TestMemoryBus, bank: number, addr: number, value: number) {
  bus.write8(((bank & 0xff) << 16) | (addr & 0xffff), value & 0xff);
}

describe('RTI in native mode restores PBR', () => {
  it('IRQ -> RTI returns to original bank:PC', () => {
    const bus = new TestMemoryBus();
    const start = 0x8080;
    setReset(bus, start);

    // Program: XCE (enter native), JML 23:9000 ; then we will trigger IRQ externally
    w(bus, 0x00, start + 0, 0xfb); // XCE
    w(bus, 0x00, start + 1, 0x5c); // JML long
    w(bus, 0x00, start + 2, 0x00);
    w(bus, 0x00, start + 3, 0x90);
    w(bus, 0x00, start + 4, 0x23);

    // At 00:6000 place RTI; point native IRQ vector there
    w(bus, 0x00, 0xffee, 0x00);
    w(bus, 0x00, 0xffef, 0x60);
    w(bus, 0x00, 0x6000, 0x40); // RTI

    const cpu = new CPU65C816(bus);
    cpu.reset();

    cpu.stepInstruction(); // XCE -> native
    expect(cpu.state.E).toBe(false);

    cpu.stepInstruction(); // JML -> 23:9000
    expect(cpu.state.PBR & 0xff).toBe(0x23);
    const pcBefore = cpu.state.PC & 0xffff;
    const pbrBefore = cpu.state.PBR & 0xff;

    // Trigger IRQ and then execute RTI
    cpu.irq();
    expect(cpu.state.PC).toBe(0x6000);
    cpu.stepInstruction(); // RTI

    expect(cpu.state.PBR & 0xff).toBe(pbrBefore);
    expect(cpu.state.PC & 0xffff).toBe(pcBefore);
  });
});

