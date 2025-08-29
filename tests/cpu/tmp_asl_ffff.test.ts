import { describe, it, expect } from 'vitest';
import { CPU65C816, Flag } from '../../src/cpu/cpu65c816';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';

function setReset(bus: TestMemoryBus, addr: number) {
  bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
  bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}

describe('Focused: ASL abs at $FFFF (wrap within same bank)', () => {
  it('M=0: ASL $FFFF reads/writes within DBR bank, low then high (FFFF -> 0000)', () => {
    const bus = new TestMemoryBus();
    const start = 0x8000;
    setReset(bus, start);

    // Program: ASL $FFFF (absolute)
    const prog = [
      0x0e, 0xff, 0xff,
    ];
    prog.forEach((b, i) => bus.write8((0x00 << 16) | (start + i), b));

    // Seed DBR bank memory with 16-bit value 0x8000 at $DBR:FFFF (lo at FFFF, hi at 0000)
    const DBR = 0x7e;
    bus.write8(((DBR << 16) | 0xffff) >>> 0, 0x00);
    bus.write8(((DBR << 16) | 0x0000) >>> 0, 0x80);
    // Also seed next bank $DBR+1:$0000 to a sentinel; absolute must NOT touch this
    bus.write8((((DBR + 1) & 0xff) << 16) | 0x0000, 0xaa);

    const cpu = new CPU65C816(bus);
    cpu.reset();
    // Enter native mode with M=0 (16-bit memory ops)
    cpu.state.E = false;
    cpu.state.P &= ~(Flag.M | Flag.X);
    cpu.state.DBR = DBR & 0xff;

    // Execute
    cpu.stepInstruction();

    const lo = bus.read8(((DBR << 16) | 0xffff) >>> 0) & 0xff;
    const hi = bus.read8(((DBR << 16) | 0x0000) >>> 0) & 0xff;
    const nextBank0000 = bus.read8((((DBR + 1) & 0xff) << 16) | 0x0000) & 0xff;

    // Result of ASL 0x8000 is 0x0000, carry set
    expect(lo).toBe(0x00);
    expect(hi).toBe(0x00);
    expect(nextBank0000).toBe(0xaa);
    expect((cpu.state.P & Flag.C) !== 0).toBe(true);
  });
});
