import { describe, it, expect } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816, Flag } from '../../src/cpu/cpu65c816';

function setReset(bus: TestMemoryBus, addr: number) {
  bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
  bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}

describe('CPU basic ops: LDA #imm, ADC #imm, CLC/SEC, BEQ/BNE', () => {
  it('LDA #imm (8-bit) sets A and Z/N', () => {
    const bus = new TestMemoryBus();
    const start = 0x8000;
    setReset(bus, start);
    // program: LDA #$00 ; LDA #$80
    bus.write8((0x00 << 16) | start, 0xa9); // LDA #
    bus.write8((0x00 << 16) | (start + 1), 0x00);
    bus.write8((0x00 << 16) | (start + 2), 0xa9); // LDA #
    bus.write8((0x00 << 16) | (start + 3), 0x80);

    const cpu = new CPU65C816(bus);
    cpu.reset();

    cpu.stepInstruction();
    expect(cpu.state.A & 0xff).toBe(0x00);
    expect((cpu.state.P & Flag.Z) !== 0).toBe(true);
    expect((cpu.state.P & Flag.N) !== 0).toBe(false);

    cpu.stepInstruction();
    expect(cpu.state.A & 0xff).toBe(0x80);
    expect((cpu.state.P & Flag.Z) !== 0).toBe(false);
    expect((cpu.state.P & Flag.N) !== 0).toBe(true);
  });

  it('ADC #imm (8-bit) with CLC/SEC and Z/N/C/V flags', () => {
    const bus = new TestMemoryBus();
    const start = 0x4000;
    setReset(bus, start);
    // program: CLC; LDA #$10; ADC #$0F; SEC; ADC #$01
    const prog = [
      0x18, // CLC
      0xa9, 0x10, // LDA #$10
      0x69, 0x0f, // ADC #$0F => 0x1F, C=0, V=0, Z=0, N=0
      0x38, // SEC
      0x69, 0x01, // ADC #$01 => 0x21, C=0, V=0, Z=0, N=0
    ];
    for (let i = 0; i < prog.length; i++) bus.write8((0x00 << 16) | (start + i), prog[i]);

    const cpu = new CPU65C816(bus);
    cpu.reset();

    cpu.stepInstruction(); // CLC
    expect((cpu.state.P & Flag.C) !== 0).toBe(false);

    cpu.stepInstruction(); // LDA
    expect(cpu.state.A & 0xff).toBe(0x10);

    cpu.stepInstruction(); // ADC #$0F
    expect(cpu.state.A & 0xff).toBe(0x1f);
    expect((cpu.state.P & Flag.C) !== 0).toBe(false);
    expect((cpu.state.P & Flag.V) !== 0).toBe(false);
    expect((cpu.state.P & Flag.Z) !== 0).toBe(false);
    expect((cpu.state.P & Flag.N) !== 0).toBe(false);

    cpu.stepInstruction(); // SEC
    expect((cpu.state.P & Flag.C) !== 0).toBe(true);

    cpu.stepInstruction(); // ADC #$01
    expect(cpu.state.A & 0xff).toBe(0x21);
    expect((cpu.state.P & Flag.C) !== 0).toBe(false);
  });

  it('BEQ/BNE relative branching (8-bit offset)', () => {
    const bus = new TestMemoryBus();
    const start = 0x2000;
    setReset(bus, start);
    // program: LDA #$00; BEQ +2; LDA #$01; NOP; LDA #$02; BNE +2; LDA #$03; NOP
    const prog = [
      0xa9, 0x00,       // A=0, Z=1
      0xf0, 0x02,       // BEQ skip next LDA
      0xa9, 0x01,       // (skipped)
      0xea,             // NOP
      0xa9, 0x02,       // A=2, Z=0
      0xd0, 0x02,       // BNE skip next LDA
      0xa9, 0x03,       // (skipped)
      0xea              // NOP
    ];
    for (let i = 0; i < prog.length; i++) bus.write8((0x00 << 16) | (start + i), prog[i]);

    const cpu = new CPU65C816(bus);
    cpu.reset();

    cpu.stepInstruction(); // LDA #$00, Z=1
    cpu.stepInstruction(); // BEQ taken
    cpu.stepInstruction(); // NOP (skipped the LDA #$01)
    cpu.stepInstruction(); // LDA #$02
    cpu.stepInstruction(); // BNE taken
    cpu.stepInstruction(); // NOP (skipped LDA #$03)

    expect(cpu.state.A & 0xff).toBe(0x02);
  });
});

