import { describe, it, expect } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816 } from '../../src/cpu/cpu65c816';

function setReset(bus: TestMemoryBus, addr: number) {
  bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
  bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}

function write(bus: TestMemoryBus, addr24: number, bytes: number[]) {
  let a = addr24;
  for (const b of bytes) bus.write8(a++, b & 0xff);
}

function flagsZNV(P: number) {
  return { Z: (P & 0x02) !== 0, N: (P & 0x80) !== 0, V: (P & 0x40) !== 0 };
}

describe('BIT indexed modes', () => {
  it('BIT dp,X sets Z from A&M and N/V from memory in 8-bit A', () => {
    const bus = new TestMemoryBus();
    const start = 0x8000;
    setReset(bus, start);
    // Program: LDA #$0F; SEP #$20 (force M=1); LDX #$02; BIT $10,X; BRK
    write(bus, 0x00008000, [0xa9, 0x0f, 0xe2, 0x20, 0xa2, 0x02, 0x34, 0x10, 0x00]);
    // Memory at D+($10+X)= $00:0012 -> 0b11010001 => N=1, V=1, A&M=0x0F & 0xD1 = 0x01 -> Z=0
    bus.write8(0x00000012, 0xd1);
    const cpu = new CPU65C816(bus);
    cpu.reset();
    for (let i = 0; i < 5; i++) cpu.stepInstruction();
    const f = flagsZNV(cpu.state.P);
    expect(f.Z).toBe(false);
    expect(f.N).toBe(true);
    expect(f.V).toBe(true);
  });

  it('BIT abs,X sets flags with 16-bit A (M=0)', () => {
    const bus = new TestMemoryBus();
    const start = 0x8000;
    setReset(bus, start);
    // Program: CLC; XCE (enter native); REP #$30 (M=0,X=0 16-bit index); LDX #$0002; LDA #$00FF; BIT $1234,X; BRK
    write(bus, 0x00008000, [0x18, 0xfb, 0xc2, 0x30, 0xa2, 0x02, 0x00, 0xa9, 0xff, 0x00, 0x3c, 0x34, 0x12, 0x00]);
    // At $00:1236 store 0x00 0xC0 (lo, hi)-> value 0xC000 => N=1, V=1, A&M=0x00FF & 0xC000 = 0 -> Z=1
    bus.write8(0x00001236, 0x00);
    bus.write8(0x00001237, 0xc0);
    const cpu = new CPU65C816(bus);
    cpu.reset();
    for (let i = 0; i < 7; i++) cpu.stepInstruction();
    const f = flagsZNV(cpu.state.P);
    expect(f.Z).toBe(true);
    expect(f.N).toBe(true);
    expect(f.V).toBe(true);
  });
});

