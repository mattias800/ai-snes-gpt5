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

describe('BCD ADC/SBC behavior (8-bit and 16-bit)', () => {
  it('ADC 8-bit BCD simple cases', () => {
    const bus = new TestMemoryBus();
    const start = 0x6000;
    setReset(bus, start);
    // Program: SED; CLC; LDA #$09; ADC #$01 -> 0x10
    const prog = [
      0xf8,       // SED
      0x18,       // CLC
      0xa9, 0x09, // LDA #$09
      0x69, 0x01  // ADC #$01
    ];
    prog.forEach((b, i) => w(bus, 0x00, start + i, b));

    const cpu = new CPU65C816(bus);
    cpu.reset();
    for (let i = 0; i < prog.length; i++) cpu.stepInstruction();
    expect(cpu.state.A & 0xff).toBe(0x10);
    expect((cpu.state.P & Flag.C) !== 0).toBe(false);
    expect((cpu.state.P & Flag.Z) !== 0).toBe(false);
  });

  it('ADC 8-bit BCD carry-out 99 + 01 -> 00 with C=1', () => {
    const bus = new TestMemoryBus();
    const start = 0x6100;
    setReset(bus, start);
    const prog = [
      0xf8,       // SED
      0x18,       // CLC
      0xa9, 0x99, // LDA #$99
      0x69, 0x01  // ADC #$01 -> 0x00, C=1
    ];
    prog.forEach((b, i) => w(bus, 0x00, start + i, b));
    const cpu = new CPU65C816(bus);
    cpu.reset();
    for (let i = 0; i < prog.length; i++) cpu.stepInstruction();
    expect(cpu.state.A & 0xff).toBe(0x00);
    expect((cpu.state.P & Flag.C) !== 0).toBe(true);
    expect((cpu.state.P & Flag.Z) !== 0).toBe(true);
  });

  it('SBC 8-bit BCD 10 - 01 -> 09 with C=1', () => {
    const bus = new TestMemoryBus();
    const start = 0x6200;
    setReset(bus, start);
    const prog = [
      0xf8,        // SED
      0x38,        // SEC (no borrow)
      0xa9, 0x10,  // LDA #$10
      0xe9, 0x01   // SBC #$01 -> 0x09, C=1
    ];
    prog.forEach((b, i) => w(bus, 0x00, start + i, b));
    const cpu = new CPU65C816(bus);
    cpu.reset();
    for (let i = 0; i < prog.length; i++) cpu.stepInstruction();
    expect(cpu.state.A & 0xff).toBe(0x09);
    expect((cpu.state.P & Flag.C) !== 0).toBe(true);
  });

  it('SBC 8-bit BCD 00 - 01 -> 99 with C=0 (borrow)', () => {
    const bus = new TestMemoryBus();
    const start = 0x6300;
    setReset(bus, start);
    const prog = [
      0xf8,        // SED
      0x38,        // SEC
      0xa9, 0x00,  // LDA #$00
      0xe9, 0x01   // SBC #$01 -> 0x99, C=0
    ];
    prog.forEach((b, i) => w(bus, 0x00, start + i, b));
    const cpu = new CPU65C816(bus);
    cpu.reset();
    for (let i = 0; i < prog.length; i++) cpu.stepInstruction();
    expect(cpu.state.A & 0xff).toBe(0x99);
    expect((cpu.state.P & Flag.C) !== 0).toBe(false);
  });

  it('ADC 16-bit BCD 0099 + 0001 -> 0100', () => {
    const bus = new TestMemoryBus();
    const start = 0x6400;
    setReset(bus, start);
    const prog = [
      0xfb,             // XCE -> native
      0xc2, 0x20,       // REP #$20 -> M=0 (16-bit A)
      0xf8,             // SED
      0x18,             // CLC
      0xa9, 0x99, 0x00, // LDA #$0099
      0x69, 0x01, 0x00  // ADC #$0001 -> 0x0100
    ];
    prog.forEach((b, i) => w(bus, 0x00, start + i, b));
    const cpu = new CPU65C816(bus);
    cpu.reset();
    for (let i = 0; i < prog.length; i++) cpu.stepInstruction();
    expect(cpu.state.A & 0xffff).toBe(0x0100);
  });

  it('SBC 16-bit BCD 0100 - 0001 -> 0099', () => {
    const bus = new TestMemoryBus();
    const start = 0x6500;
    setReset(bus, start);
    const prog = [
      0xfb,             // XCE -> native
      0xc2, 0x20,       // REP #$20 -> M=0
      0xf8,             // SED
      0x38,             // SEC
      0xa9, 0x00, 0x01, // LDA #$0100
      0xe9, 0x01, 0x00  // SBC #$0001 -> 0x0099
    ];
    prog.forEach((b, i) => w(bus, 0x00, start + i, b));
    const cpu = new CPU65C816(bus);
    cpu.reset();
    for (let i = 0; i < prog.length; i++) cpu.stepInstruction();
    expect(cpu.state.A & 0xffff).toBe(0x0099);
  });
});

