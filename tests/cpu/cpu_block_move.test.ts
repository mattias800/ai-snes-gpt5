import { describe, it, expect } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816 } from '../../src/cpu/cpu65c816';

function setReset(bus: TestMemoryBus, addr: number) {
  bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
  bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}

function w(bus: TestMemoryBus, addr: number, v: number) { bus.write8(addr, v); }

describe('CPU block move MVP/MVN (simplified)', () => {
  it('MVP copies bytes from srcBank:X..down to dstBank:Y..down and decrements A count', () => {
    const bus = new TestMemoryBus();
    const start = 0x8000;
    setReset(bus, start);
    // Program: set A=#3 (copy 4 bytes), X=$0003, Y=$1003, MVP $12,$34
    // In our simplified CPU, A is 8-bit so #3 means 4 bytes
    const prog = [
      0xa9, 0x03,       // LDA #$03 (count 4)
      0xa2, 0x03,       // LDX #$03
      0xa0, 0x03,       // LDY #$03
      0x54, 0x34, 0x12  // MVP $12,$34 (dst=$34, src=$12)
    ];
    for (let i = 0; i < prog.length; i++) w(bus, (0x00 << 16) | (start + i), prog[i]);

    // Seed src bytes at 12:0000..0003
    for (let i = 0; i < 4; i++) bus.write8((0x12 << 16) | i, 0xA0 + i);

    const cpu = new CPU65C816(bus);
    cpu.reset();
    // Execute: LDA, LDX, LDY, MVP
    cpu.stepInstruction();
    cpu.stepInstruction();
    cpu.stepInstruction();
    cpu.stepInstruction();

    // Expect dst at 34:0000..0003 == A0..A3
    for (let i = 0; i < 4; i++) {
      const v = bus.read8((0x34 << 16) | (0x0000 + i));
      expect(v).toBe(0xA0 + i);
    }
  });

  it('MVN copies bytes from srcBank:X..up to dstBank:Y..up and decrements A count', () => {
    const bus = new TestMemoryBus();
    const start = 0x9000;
    setReset(bus, start);
    // Program: A=#1 (2 bytes), X=$0000, Y=$2000, MVN $56,$78
    const prog = [
      0xa9, 0x01,
      0xa2, 0x00,
      0xa0, 0x00,
      0x44, 0x78, 0x56
    ];
    for (let i = 0; i < prog.length; i++) w(bus, (0x00 << 16) | (start + i), prog[i]);

    // Seed src at 56:0000..0001
    bus.write8((0x56 << 16) | 0x0000, 0x11);
    bus.write8((0x56 << 16) | 0x0001, 0x22);

    const cpu = new CPU65C816(bus);
    cpu.reset();
    cpu.stepInstruction();
    cpu.stepInstruction();
    cpu.stepInstruction();
    cpu.stepInstruction();

    expect(bus.read8((0x78 << 16) | 0x0000)).toBe(0x11);
    expect(bus.read8((0x78 << 16) | 0x0001)).toBe(0x22);
  });
});

