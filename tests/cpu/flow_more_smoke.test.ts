import { describe, it, expect } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816, Flag } from '../../src/cpu/cpu65c816';

function w(bus: TestMemoryBus, bank: number, addr: number, v: number) {
  bus.write8(((bank & 0xff) << 16) | (addr & 0xffff), v & 0xff);
}
function setReset(bus: TestMemoryBus, addr: number) {
  w(bus, 0x00, 0xfffc, addr & 0xff);
  w(bus, 0x00, 0xfffd, (addr >>> 8) & 0xff);
}

describe('Control-flow smoke tests', () => {
  it('JSR/RTS roundtrip (emulation mode)', () => {
    const bus = new TestMemoryBus();
    const start = 0x8000;
    setReset(bus, start);
    // Program at 00:8000: JSR $9000
    w(bus, 0x00, start + 0, 0x20); // JSR abs
    w(bus, 0x00, start + 1, 0x00);
    w(bus, 0x00, start + 2, 0x90);
    // Subroutine at 00:9000: RTS
    w(bus, 0x00, 0x9000, 0x60);

    const cpu = new CPU65C816(bus);
    cpu.reset();
    expect(cpu.state.PC).toBe(start);

    cpu.stepInstruction(); // JSR
    expect(cpu.state.PC).toBe(0x9000);
    // SP should have decreased by 2 (pushed return addr high then low)
    expect(cpu.state.S & 0xffff).toBe(0x01fd);

    cpu.stepInstruction(); // RTS
    // Return to byte after JSR operands (1+2 bytes -> 0x8003)
    expect(cpu.state.PC).toBe(0x8003);
  });

  it('JSL/RTL roundtrip across bank', () => {
    const bus = new TestMemoryBus();
    const start = 0x8100;
    setReset(bus, start);
    // Program: JSL $05:9000
    w(bus, 0x00, start + 0, 0x22);
    w(bus, 0x00, start + 1, 0x00);
    w(bus, 0x00, start + 2, 0x90);
    w(bus, 0x00, start + 3, 0x05);
    // At 05:9000 place RTL
    w(bus, 0x05, 0x9000, 0x6b);

    const cpu = new CPU65C816(bus);
    cpu.reset();

    cpu.stepInstruction(); // JSL
    expect(cpu.state.PBR).toBe(0x05);
    expect(cpu.state.PC).toBe(0x9000);

    cpu.stepInstruction(); // RTL
    // Return to 00:8104 (after JSL)
    expect(cpu.state.PBR).toBe(0x00);
    expect(cpu.state.PC).toBe(0x8104);
  });

  it('JMP absolute and (abs) and (abs,X)', () => {
    const bus = new TestMemoryBus();
    const start = 0x8200;
    setReset(bus, start);
    // JMP abs -> $8400
    w(bus, 0x00, start + 0, 0x4c);
    w(bus, 0x00, start + 1, 0x00);
    w(bus, 0x00, start + 2, 0x84);
    // At $8400: create pointer table and exercise (abs) and (abs,X)
    // ($8500) -> $8601
    w(bus, 0x00, 0x8500, 0x01);
    w(bus, 0x00, 0x8501, 0x86);
    // ($8502+X) with X=2 -> read pointer at $8504 = $8702
    w(bus, 0x00, 0x8504, 0x02);
    w(bus, 0x00, 0x8505, 0x87);
    // Sequence at $8400: LDX #$02; JMP ($8500); JMP ($8502,X)
    w(bus, 0x00, 0x8400, 0xa2); // LDX #$02
    w(bus, 0x00, 0x8401, 0x02);
    w(bus, 0x00, 0x8402, 0x6c); // JMP ($8500)
    w(bus, 0x00, 0x8403, 0x00);
    w(bus, 0x00, 0x8404, 0x85);
    // Destination $8601: JMP ($8502,X)
    w(bus, 0x00, 0x8601, 0x7c);
    w(bus, 0x00, 0x8602, 0x02);
    w(bus, 0x00, 0x8603, 0x85);

    const cpu = new CPU65C816(bus);
    cpu.reset();

    cpu.stepInstruction(); // initial JMP abs -> $8400
    expect(cpu.state.PC).toBe(0x8400);

    cpu.stepInstruction(); // LDX #$02
    cpu.stepInstruction(); // JMP ($8500) -> $8601
    expect(cpu.state.PC).toBe(0x8601);

    cpu.stepInstruction(); // JMP ($8502,X) -> $8702
    expect(cpu.state.PC).toBe(0x8702);
  });

  it('BEQ/BNE branches taken and not taken', () => {
    const bus = new TestMemoryBus();
    const start = 0x8800;
    setReset(bus, start);
    // Program: LDA #$00; BEQ +2; LDA #$01; NOP; LDA #$02; BNE +2; LDA #$03; NOP
    let a = start;
    w(bus, 0x00, a++, 0xa9); w(bus, 0x00, a++, 0x00); // LDA #$00 -> Z=1
    w(bus, 0x00, a++, 0xf0); w(bus, 0x00, a++, 0x02); // BEQ +2 (skip over next LDA)
    w(bus, 0x00, a++, 0xa9); w(bus, 0x00, a++, 0x01); // LDA #$01 (should be skipped)
    w(bus, 0x00, a++, 0xea);                          // NOP (landing)
    w(bus, 0x00, a++, 0xa9); w(bus, 0x00, a++, 0x02); // LDA #$02 -> Z=0
    w(bus, 0x00, a++, 0xd0); w(bus, 0x00, a++, 0x02); // BNE +2 (should take, skip next LDA)
    w(bus, 0x00, a++, 0xa9); w(bus, 0x00, a++, 0x03); // LDA #$03 (skipped)
    w(bus, 0x00, a++, 0xea);                          // NOP

    const cpu = new CPU65C816(bus);
    cpu.reset();

    cpu.stepInstruction(); // LDA #$00
    cpu.stepInstruction(); // BEQ taken
    cpu.stepInstruction(); // NOP
    cpu.stepInstruction(); // LDA #$02
    cpu.stepInstruction(); // BNE taken
    cpu.stepInstruction(); // NOP

    // Final accumulator should be $02
    expect(cpu.state.A & 0xff).toBe(0x02);
  });

  it('BRK -> RTI roundtrip restores PC', () => {
    const bus = new TestMemoryBus();
    const start = 0x8a00;
    setReset(bus, start);
    // Program: BRK; (next would be NOP)
    w(bus, 0x00, start + 0, 0x00);
    w(bus, 0x00, start + 1, 0xea);
    // Emulation BRK vector $FFFE/$FFFF -> $9000; handler: RTI
    w(bus, 0x00, 0xfffe, 0x00);
    w(bus, 0x00, 0xffff, 0x90);
    w(bus, 0x00, 0x9000, 0x40); // RTI

    const cpu = new CPU65C816(bus);
    cpu.reset();
    expect(cpu.state.E).toBe(true);

    cpu.stepInstruction(); // BRK -> to 00:9000
    expect(cpu.state.PC).toBe(0x9000);

    cpu.stepInstruction(); // RTI -> back to start+1 (next byte after BRK opcode fetch)
    expect(cpu.state.PC).toBe(0x8a01);
  });
});
