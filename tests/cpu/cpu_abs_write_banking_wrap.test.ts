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

function r(bus: TestMemoryBus, bank: number, addr: number) {
  return bus.read8(((bank & 0xff) << 16) | (addr & 0xffff)) & 0xff;
}

describe('Absolute 16-bit writes do not carry into next bank', () => {
  it('STA $FFFF (16-bit, DBR=0x40) writes to 40:FFFF and 40:0000, not 41:0000', () => {
    const bus = new TestMemoryBus();
    const start = 0x8000;
    setReset(bus, start);

    // Pre-fill 41:0000 to catch incorrect bank carry
    w(bus, 0x41, 0x0000, 0x99);

    // Program: XCE; REP #$20 (M=0); LDA #$1234; STA $FFFF; BRK
    w(bus, 0x00, start + 0, 0xfb); // XCE -> native
    w(bus, 0x00, start + 1, 0xc2); // REP
    w(bus, 0x00, start + 2, 0x20); // clear M
    w(bus, 0x00, start + 3, 0xa9); // LDA #imm
    w(bus, 0x00, start + 4, 0x34);
    w(bus, 0x00, start + 5, 0x12);
    w(bus, 0x00, start + 6, 0x8d); // STA abs
    w(bus, 0x00, start + 7, 0xff);
    w(bus, 0x00, start + 8, 0xff);

    const cpu = new CPU65C816(bus);
    cpu.reset();

    // Enter native mode and configure DBR
    cpu.stepInstruction(); // XCE
    expect(cpu.state.E).toBe(false);
    cpu.state.DBR = 0x40; // set data bank to 0x40 for absolute addressing

    cpu.stepInstruction(); // REP #$20 (M=0)
    cpu.stepInstruction(); // LDA #$1234
    cpu.stepInstruction(); // STA $FFFF (16-bit)

    expect(r(bus, 0x40, 0xffff)).toBe(0x34);
    expect(r(bus, 0x40, 0x0000)).toBe(0x12);
    // Ensure 41:0000 was not touched
    expect(r(bus, 0x41, 0x0000)).toBe(0x99);
  });
});

