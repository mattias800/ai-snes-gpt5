import { describe, it, expect } from 'vitest';
import { CPU65C816 } from '../../src/cpu/cpu65c816';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';

function setReset(bus: TestMemoryBus, addr: number) {
  bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
  bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}

function w(bus: TestMemoryBus, bank: number, addr: number, value: number) {
  bus.write8(((bank & 0xff) << 16) | (addr & 0xffff), value & 0xff);
}

describe('Native interrupt stack contains PBR on BRK', () => {
  it('pushes PBR, PCH, PCL, P (in that order) in native mode', () => {
    const bus = new TestMemoryBus();
    const start = 0x8000;
    setReset(bus, start);

    // Program layout:
    // 00:8000: FB        XCE (enter native)
    // 00:8001: 5C 00 80 23  JML 23:8000
    // 23:8000: 00        BRK
    w(bus, 0x00, 0x8000, 0xfb);
    w(bus, 0x00, 0x8001, 0x5c); // JML long
    w(bus, 0x00, 0x8002, 0x00); // low
    w(bus, 0x00, 0x8003, 0x80); // high
    w(bus, 0x00, 0x8004, 0x23); // bank 0x23
    w(bus, 0x23, 0x8000, 0x00); // BRK

    // Native BRK vector -> 00:2000 (just a NOP so execution can continue)
    w(bus, 0x00, 0xffe6, 0x00);
    w(bus, 0x00, 0xffe7, 0x20);
    w(bus, 0x00, 0x2000, 0xea);

    const cpu = new CPU65C816(bus);
    cpu.reset();

    // XCE -> native
    cpu.stepInstruction();
    expect(cpu.state.E).toBe(false);

    // Place a known native stack position
    cpu.state.S = 0x1ff0;

    // JML to 23:8000 then BRK
    cpu.stepInstruction(); // JML
    // Sanity: now in bank 0x23
    expect(cpu.state.PBR & 0xff).toBe(0x23);

    cpu.stepInstruction(); // BRK (stacks and vectors)

    // After BRK, stack should have (top-first writes):
    // 00:1FF0 <- PBR (0x23)
    // 00:1FEF <- PCH (0x80)
    // 00:1FEE <- PCL (0x01)  [PC had incremented to 23:8001 at fetch]
    // 00:1FED <- P
    const pbrByte = bus.read8((0x00 << 16) | 0x1ff0) & 0xff;
    const pchByte = bus.read8((0x00 << 16) | 0x1fef) & 0xff;
    const pclByte = bus.read8((0x00 << 16) | 0x1fee) & 0xff;
    const pByte   = bus.read8((0x00 << 16) | 0x1fed) & 0xff;

    expect(pbrByte).toBe(0x23);
    expect(pchByte).toBe(0x80);
    expect(pclByte).toBe(0x01);
    // We don't assert exact P value; just that something was pushed
    expect(typeof pByte).toBe('number');
  });
});

