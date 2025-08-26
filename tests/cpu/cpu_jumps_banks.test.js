import { describe, it, expect } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816 } from '../../src/cpu/cpu65c816';
function setReset(bus, addr) {
    bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
    bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}
function writeByte(bus, bank, addr, value) {
    bus.write8(((bank & 0xff) << 16) | (addr & 0xffff), value & 0xff);
}
function writeProg(bus, bank, start, bytes) {
    for (let i = 0; i < bytes.length; i++)
        writeByte(bus, bank, start + i, bytes[i]);
}
describe('CPU long jumps and bank operations', () => {
    it('JSL to another bank, PHK/PLB set DBR to current bank, RTL returns to caller', () => {
        const bus = new TestMemoryBus();
        const start = 0x8000;
        setReset(bus, start);
        // Caller at 00:8000
        // JSL $12:3456
        // NOP (after return)
        writeProg(bus, 0x00, start, [
            0x22, 0x56, 0x34, 0x12, // JSL $12:3456
            0xea // NOP
        ]);
        // Callee at 12:3456
        // PHK; PLB; LDA #$99; STA $1234; RTL
        writeProg(bus, 0x12, 0x3456, [
            0x4b, // PHK (push PBR=0x12)
            0xab, // PLB -> DBR=0x12
            0xa9, 0x99, // LDA #$99
            0x8d, 0x34, 0x12, // STA $1234 (writes to DBR:1234 -> 12:1234)
            0x6b // RTL
        ]);
        const cpu = new CPU65C816(bus);
        cpu.reset();
        // Step JSL (enters bank 0x12)
        cpu.stepInstruction();
        expect(cpu.state.PBR).toBe(0x12);
        // Execute callee: PHK, PLB, LDA, STA, RTL => 5 instructions
        for (let i = 0; i < 5; i++)
            cpu.stepInstruction();
        // After RTL, back to bank 0x00 and PC should point to NOP (already fetched next)
        expect(cpu.state.PBR).toBe(0x00);
        // Execute NOP to confirm we returned correctly
        cpu.stepInstruction();
        // Verify write occurred at 12:1234
        const val = bus.read8((0x12 << 16) | 0x1234);
        expect(val).toBe(0x99);
    });
    it('XBA swaps accumulator bytes and sets Z/N on low byte', () => {
        const bus = new TestMemoryBus();
        const start = 0x4000;
        setReset(bus, start);
        // Program: LDA #$80; XBA; (A=0x8000); XBA; (A=0x0080)
        writeProg(bus, 0x00, start, [0xa9, 0x80, 0xeb, 0xeb]);
        const cpu = new CPU65C816(bus);
        cpu.reset();
        cpu.stepInstruction(); // LDA #$80 -> A low=0x80
        expect(cpu.state.A & 0xff).toBe(0x80);
        cpu.stepInstruction(); // XBA -> low<=hi(0), hi<=low(0x80)
        expect(cpu.state.A & 0xff).toBe(0x00);
        expect((cpu.state.P & 2 /* Flag.Z */) !== 0).toBe(true);
        cpu.stepInstruction(); // XBA -> low<=hi(0x80)
        expect(cpu.state.A & 0xff).toBe(0x80);
        expect((cpu.state.P & 128 /* Flag.N */) !== 0).toBe(true);
    });
});
