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

describe('CPU transfers width-aware in native mode', () => {
  it('TAX/TAY, TXA/TYA transfer 8 or 16 bits depending on X/M flags', () => {
    const bus = new TestMemoryBus();
    const start = 0x7000;
    setReset(bus, start);
    // Enter native mode, clear M and X (16-bit A and 16-bit index), then verify transfers
    const prog = [
      0xfb,             // XCE -> native (E <- C(0), C <- oldE(1))
      0xc2, 0x30,       // REP #$30 -> clear M and X (M=0, X=0)
      0xa9, 0x34, 0x12, // LDA #$1234 (16-bit)
      0xaa,             // TAX -> X=0x1234
      0xa8,             // TAY -> Y=0x1234
      0x8a,             // TXA -> A=0x1234
      0x98              // TYA -> A=0x1234
    ];
    prog.forEach((b, i) => w(bus, 0x00, start + i, b));

    const cpu = new CPU65C816(bus);
    cpu.reset();

    // Execute 7 instructions
    for (let i = 0; i < 7; i++) cpu.stepInstruction();

    expect(cpu.state.E).toBe(false);
    expect((cpu.state.P & Flag.M) !== 0).toBe(false);
    expect((cpu.state.P & Flag.X) !== 0).toBe(false);

    expect(cpu.state.A & 0xffff).toBe(0x1234);
    expect(cpu.state.X & 0xffff).toBe(0x1234);
    expect(cpu.state.Y & 0xffff).toBe(0x1234);

    // Now set X=1 (8-bit index), then LDX #$FF and TXA with M=0 should zero-extend to 0x00FF
    const pc = cpu.state.PC;
    const cont = [
      0xe2, 0x10, // SEP #$10 -> X=1
      0xa2, 0xff, // LDX #$FF (8-bit)
      0x8a        // TXA (A=0x00FF since M=0)
    ];
    cont.forEach((b, i) => w(bus, 0x00, pc + i, b));

    cpu.stepInstruction(); // SEP #$10
    cpu.stepInstruction(); // LDX #
    cpu.stepInstruction(); // TXA

    expect((cpu.state.P & Flag.X) !== 0).toBe(true);
    expect(cpu.state.X & 0xff).toBe(0xff);
    expect(cpu.state.A & 0xffff).toBe(0x00ff);
  });

  it('TSX/TXS respect index width and emulation/native differences', () => {
    // Emulation mode behavior
    {
      const bus = new TestMemoryBus();
      const start = 0x7100;
      setReset(bus, start);
      const prog = [
        0xa9, 0x55, // LDA #$55
        0x1b,       // TCS -> S=0x0155 in E-mode
        0xba,       // TSX -> X=0x55 (8-bit)
        0x9a        // TXS -> S=0x0155 again
      ];
      prog.forEach((b, i) => w(bus, 0x00, start + i, b));
      const cpu = new CPU65C816(bus);
      cpu.reset();
      // Execute 4 instructions
      for (let i = 0; i < 4; i++) cpu.stepInstruction();
      expect(cpu.state.S).toBe(0x0155);
      expect(cpu.state.X & 0xff).toBe(0x55);
    }

    // Native mode, 16-bit index
    {
      const bus = new TestMemoryBus();
      const start = 0x7200;
      setReset(bus, start);
      const prog = [
        0xfb,             // XCE -> native
        0xc2, 0x10,       // REP #$10 -> X=0 (16-bit)
        0xa2, 0x34, 0x12, // LDX #$1234
        0x9a,             // TXS -> S=0x1234
        0xba              // TSX -> X=0x1234
      ];
      prog.forEach((b, i) => w(bus, 0x00, start + i, b));
      const cpu = new CPU65C816(bus);
      cpu.reset();
      // Execute 5 instructions
      for (let i = 0; i < 5; i++) cpu.stepInstruction();
      expect(cpu.state.E).toBe(false);
      expect((cpu.state.P & Flag.X) !== 0).toBe(false);
      expect(cpu.state.S & 0xffff).toBe(0x1234);
      expect(cpu.state.X & 0xffff).toBe(0x1234);
    }

    // Native mode, 8-bit index
    {
      const bus = new TestMemoryBus();
      const start = 0x7300;
      setReset(bus, start);
      const prog = [
        0xfb,       // XCE -> native
        0xe2, 0x10, // SEP #$10 -> X=1 (8-bit index)
        0xa2, 0xaa, // LDX #$AA (8-bit immediate)
        0x9a,       // TXS -> update low byte of S only
        0xba        // TSX -> X = low byte of S
      ];
      prog.forEach((b, i) => w(bus, 0x00, start + i, b));
      const cpu = new CPU65C816(bus);
      cpu.reset();
      // Execute 5 instructions
      for (let i = 0; i < 5; i++) cpu.stepInstruction();
      expect(cpu.state.E).toBe(false);
      expect((cpu.state.P & Flag.X) !== 0).toBe(true);
      expect(cpu.state.S & 0xff).toBe(0xaa);
      expect(cpu.state.X & 0xff).toBe(0xaa);
    }
  });
});

