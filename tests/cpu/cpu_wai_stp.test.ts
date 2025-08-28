import { describe, it, expect } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816 } from '../../src/cpu/cpu65c816';

function setReset(bus: TestMemoryBus, addr: number) {
  bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
  bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}

function setVector(bus: TestMemoryBus, loAddr: number, target: number) {
  bus.write8((0x00 << 16) | loAddr, target & 0xff);
  bus.write8((0x00 << 16) | ((loAddr + 1) & 0xffff), (target >>> 8) & 0xff);
}

describe('CPU low-power instructions WAI/STP', () => {
  it('WAI halts until IRQ; IRQ handler RTI resumes at next instruction', () => {
    const bus = new TestMemoryBus();
    const start = 0x8000;
    const irqHandler = 0x9000;
    setReset(bus, start);
    // Program: WAI; NOP
    bus.write8((0x00 << 16) | start, 0xcb); // WAI
    bus.write8((0x00 << 16) | ((start + 1) & 0xffff), 0xea); // NOP
    // IRQ vector (emulation mode) $FFFE/$FFFF -> irqHandler
    setVector(bus, 0xfffe, irqHandler);
    // IRQ handler: RTI
    bus.write8((0x00 << 16) | irqHandler, 0x40);

    const cpu = new CPU65C816(bus);
    cpu.reset();
    expect(cpu.state.PC).toBe(start);

    // Execute WAI
    cpu.stepInstruction();
    const pcAfterWai = (start + 1) & 0xffff;
    expect(cpu.state.PC).toBe(pcAfterWai);

    // While waiting, stepping does nothing
    cpu.stepInstruction();
    expect(cpu.state.PC).toBe(pcAfterWai);

    // Trigger IRQ: should clear wait state and vector to handler
    cpu.irq();
    expect(cpu.state.PC).toBe(irqHandler);

    // Execute RTI, returning to next instruction after WAI
    cpu.stepInstruction();
    expect(cpu.state.PC).toBe(pcAfterWai);

    // Now CPU runs the NOP
    cpu.stepInstruction();
    expect(cpu.state.PC).toBe((start + 2) & 0xffff);
  });

  it('WAI halts until NMI; NMI handler RTI resumes at next instruction', () => {
    const bus = new TestMemoryBus();
    const start = 0x4000;
    const nmiHandler = 0x9100;
    setReset(bus, start);
    // Program: WAI; NOP
    bus.write8((0x00 << 16) | start, 0xcb); // WAI
    bus.write8((0x00 << 16) | ((start + 1) & 0xffff), 0xea); // NOP
    // NMI vector (emulation mode) $FFFA/$FFFB -> nmiHandler
    setVector(bus, 0xfffa, nmiHandler);
    // NMI handler: RTI
    bus.write8((0x00 << 16) | nmiHandler, 0x40);

    const cpu = new CPU65C816(bus);
    cpu.reset();
    expect(cpu.state.PC).toBe(start);

    // Execute WAI
    cpu.stepInstruction();
    const pcAfterWai = (start + 1) & 0xffff;
    expect(cpu.state.PC).toBe(pcAfterWai);

    // While waiting, stepping does nothing
    cpu.stepInstruction();
    expect(cpu.state.PC).toBe(pcAfterWai);

    // Trigger NMI: should clear wait state and vector to handler
    cpu.nmi();
    expect(cpu.state.PC).toBe(nmiHandler);

    // Execute RTI, returning to next instruction after WAI
    cpu.stepInstruction();
    expect(cpu.state.PC).toBe(pcAfterWai);

    // Now CPU runs the NOP
    cpu.stepInstruction();
    expect(cpu.state.PC).toBe((start + 2) & 0xffff);
  });

  it('STP halts CPU permanently; IRQ/NMI ignored', () => {
    const bus = new TestMemoryBus();
    const start = 0x6000;
    setReset(bus, start);
    // Program: STP; NOP
    bus.write8((0x00 << 16) | start, 0xdb); // STP
    bus.write8((0x00 << 16) | ((start + 1) & 0xffff), 0xea); // NOP (should never execute)

    const cpu = new CPU65C816(bus);
    cpu.reset();
    expect(cpu.state.PC).toBe(start);

    // Execute STP
    cpu.stepInstruction();
    const pcAfterStp = (start + 1) & 0xffff;
    expect(cpu.state.PC).toBe(pcAfterStp);

    // Further steps do nothing
    cpu.stepInstruction();
    expect(cpu.state.PC).toBe(pcAfterStp);

    // IRQ and NMI are ignored while stopped
    cpu.irq();
    expect(cpu.state.PC).toBe(pcAfterStp);
    cpu.nmi();
    expect(cpu.state.PC).toBe(pcAfterStp);

    // Still halted
    cpu.stepInstruction();
    expect(cpu.state.PC).toBe(pcAfterStp);
  });
});

