import { describe, it, expect } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816, Flag } from '../../src/cpu/cpu65c816';

function setReset(bus: TestMemoryBus, addr: number) {
  bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
  bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}

describe('CPU logic ops (AND/ORA/EOR)', () => {
  it('AND/ORA/EOR immediate (8-bit) with Z/N flags', () => {
    const bus = new TestMemoryBus();
    const start = 0x8000;
    setReset(bus, start);
    const prog = [
      0xa9, 0xf0,     // LDA #$F0
      0x29, 0x0f,     // AND #$0F => A=0x00, Z=1
      0x09, 0x01,     // ORA #$01 => A=0x01, Z=0
      0x49, 0xff      // EOR #$FF => A=0xFE, N=1
    ];
    prog.forEach((b, i) => bus.write8((0x00 << 16) | (start + i), b));
    const cpu = new CPU65C816(bus);
    cpu.reset();
    while (cpu.state.PC !== ((start + prog.length) & 0xffff)) cpu.stepInstruction();
    expect(cpu.state.A & 0xff).toBe(0xfe);
    expect((cpu.state.P & Flag.Z) !== 0).toBe(false);
    expect((cpu.state.P & Flag.N) !== 0).toBe(true);
  });

  it('AND abs,X and ORA (dp),Y (8-bit)', () => {
    const bus = new TestMemoryBus();
    const start = 0x6000;
    setReset(bus, start);
    // Write memory
    bus.write8(0x00002010, 0x0f); // for abs,X with X=0x10
    // Program
    const prog = [
      0xa2, 0x10,       // LDX #$10
      0xa9, 0xf0,       // LDA #$F0
      0x3d, 0x00, 0x20, // AND $2000,X => AND $2010 => 0xF0 & 0x0F = 0x00
      0xa9, 0x01,       // LDA #$01 (leave A=1 before ORA)
    ];
    // Place pointer at D+0x20 -> points to $3000
    // We'll put value 0x80 at $3005 and Y=5 so ORA (dp),Y sees 0x80
    const D = 0x0100;
    const dp = 0x20;
    bus.write8(0x00000000 + D + dp, 0x00); // low
    bus.write8(0x00000000 + D + dp + 1, 0x30); // high
    // Write value at $3005
    bus.write8(0x00003005, 0x80);

    // Continue program
    const rest = [
      0xa0, 0x05,       // LDY #$05 (we reuse existing width rules via TXA/TYA? simplest: LDY immediate is supported above)
      0x11, dp          // ORA (dp),Y => ORA $3005 -> A becomes 0x81
    ];
    const full = prog.concat(rest);
    full.forEach((b, i) => bus.write8((0x00 << 16) | (start + i), b));

    const cpu = new CPU65C816(bus);
    cpu.reset();
    cpu.state.D = D;
    while (cpu.state.PC !== ((start + full.length) & 0xffff)) cpu.stepInstruction();
    expect(cpu.state.A & 0xff).toBe(0x81);
  });
});

