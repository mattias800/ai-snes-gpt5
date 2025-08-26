import { describe, it, expect } from 'vitest';
import { CPU65C816 } from '../../src/cpu/cpu65c816';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
function setReset(bus, addr) {
    bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
    bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}
describe('CPU shifts/rotates and addressing modes', () => {
    it('ASL/LSR/ROL/ROR on A update C and ZN correctly', () => {
        const bus = new TestMemoryBus();
        const start = 0x8000;
        setReset(bus, start);
        const prog = [
            0xa9, 0x80, // LDA #$80
            0x0a, // ASL A -> A=0x00, C=1, Z=1
            0x4a, // LSR A -> A=0x00, C=0, Z=1
            0x38, // SEC
            0x2a, // ROL A -> A=0x01, C=0, Z=0
            0x38, // SEC (set carry in for ROR)
            0x6a // ROR A -> A=0x80, C=1, N=1
        ];
        prog.forEach((b, i) => bus.write8((0x00 << 16) | (start + i), b));
        const cpu = new CPU65C816(bus);
        cpu.reset();
        while (cpu.state.PC !== ((start + prog.length) & 0xffff))
            cpu.stepInstruction();
        expect(cpu.state.A & 0xff).toBe(0x80);
        expect((cpu.state.P & 1 /* Flag.C */) !== 0).toBe(true);
        expect((cpu.state.P & 128 /* Flag.N */) !== 0).toBe(true);
        expect((cpu.state.P & 2 /* Flag.Z */) !== 0).toBe(false);
    });
    it('JMP abs branches to target', () => {
        const bus = new TestMemoryBus();
        const start = 0x4000;
        setReset(bus, start);
        // JMP $4010; NOP; target: LDA #$12
        bus.write8((0x00 << 16) | start, 0x4c);
        bus.write8((0x00 << 16) | (start + 1), 0x10);
        bus.write8((0x00 << 16) | (start + 2), 0x40);
        bus.write8((0x00 << 16) | (start + 3), 0xea);
        bus.write8((0x00 << 16) | 0x4010, 0xa9);
        bus.write8((0x00 << 16) | 0x4011, 0x12);
        const cpu = new CPU65C816(bus);
        cpu.reset();
        cpu.stepInstruction(); // JMP
        cpu.stepInstruction(); // LDA
        expect(cpu.state.A & 0xff).toBe(0x12);
    });
    it('LDA/STA dp and abs,X operate correctly', () => {
        const bus = new TestMemoryBus();
        const start = 0x6000;
        setReset(bus, start);
        // Initialize DP=0x100
        // Program: LDA #$AA; STA $10 (dp+0x10); LDX #$04; LDA #$55; STA $2000,X; LDA $2000,X -> 0x55
        const prog = [
            0xa9, 0xaa, // LDA #$AA
            0x85, 0x10, // STA dp($10)
            0xa2, 0x04, // LDX #$04
            0xa9, 0x55, // LDA #$55
            0x9d, 0x00, 0x20, // STA $2000,X -> $2004
            0xbd, 0x00, 0x20 // LDA $2000,X -> $2004
        ];
        prog.forEach((b, i) => bus.write8((0x00 << 16) | (start + i), b));
        const cpu = new CPU65C816(bus);
        cpu.reset();
        cpu.state.D = 0x0100;
        while (cpu.state.PC !== ((start + prog.length) & 0xffff))
            cpu.stepInstruction();
        // DP store
        const dpAddr = 0x0100 + 0x10;
        expect(bus.read8(dpAddr)).toBe(0xaa);
        // abs,X store and load
        expect(bus.read8(0x00002004)).toBe(0x55);
        expect(cpu.state.A & 0xff).toBe(0x55);
    });
});
