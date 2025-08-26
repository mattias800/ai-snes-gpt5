import { describe, it, expect } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816 } from '../../src/cpu/cpu65c816';
function setReset(bus, addr) {
    bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
    bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}
describe('CPU stack ops and JSR/RTS', () => {
    it('PHA/PLA + PHP/PLP affect A and P and stack pointer as expected (E-mode)', () => {
        const bus = new TestMemoryBus();
        const start = 0x7000;
        setReset(bus, start);
        // Program: LDA #$42; PHA; LDA #$00; PLA; PHP; CLC; PLP
        // After PLA, A should be 0x42 and Z/N based on 0x42
        // After PHP/CLC/PLP, flags should restore to value saved by PHP
        const prog = [
            0xa9, 0x42, // LDA #$42
            0x48, // PHA
            0xa9, 0x00, // LDA #$00 (sets Z)
            0x68, // PLA -> A=0x42, Z=0, N=0
            0x08, // PHP (push P with Z=0 now)
            0x18, // CLC (clear carry)
            0x28 // PLP (restore flags from before CLC)
        ];
        for (let i = 0; i < prog.length; i++)
            bus.write8((0x00 << 16) | (start + i), prog[i]);
        const cpu = new CPU65C816(bus);
        cpu.reset();
        const sp0 = cpu.state.S;
        cpu.stepInstruction(); // LDA #$42
        cpu.stepInstruction(); // PHA
        expect(cpu.state.S).toBe(((sp0 - 1) & 0xff) | 0x0100);
        cpu.stepInstruction(); // LDA #$00
        expect((cpu.state.P & 2 /* Flag.Z */) !== 0).toBe(true);
        cpu.stepInstruction(); // PLA -> A back to 0x42
        expect(cpu.state.A & 0xff).toBe(0x42);
        expect((cpu.state.P & 2 /* Flag.Z */) !== 0).toBe(false);
        expect((cpu.state.P & 128 /* Flag.N */) !== 0).toBe(false);
        const pBefore = cpu.state.P;
        cpu.stepInstruction(); // PHP
        cpu.stepInstruction(); // CLC (modifies P)
        expect((cpu.state.P & 1 /* Flag.C */) !== 0).toBe(false);
        cpu.stepInstruction(); // PLP (restore)
        expect(cpu.state.P).toBe(pBefore);
    });
    it('JSR/RTS pushes return address and returns correctly', () => {
        const bus = new TestMemoryBus();
        const start = 0x7100;
        setReset(bus, start);
        // Program layout:
        // 7100: JSR 0x7105
        // 7103: NOP
        // 7104: NOP
        // 7105: LDA #$55
        // 7107: RTS -> returns to 0x7103 (PC after RTS should be 0x7103; next fetch executes NOP at 0x7103)
        bus.write8((0x00 << 16) | 0x7100, 0x20); // JSR
        bus.write8((0x00 << 16) | 0x7101, 0x05);
        bus.write8((0x00 << 16) | 0x7102, 0x71);
        bus.write8((0x00 << 16) | 0x7103, 0xea); // NOP
        bus.write8((0x00 << 16) | 0x7104, 0xea); // NOP
        bus.write8((0x00 << 16) | 0x7105, 0xa9); // LDA #
        bus.write8((0x00 << 16) | 0x7106, 0x55);
        bus.write8((0x00 << 16) | 0x7107, 0x60); // RTS
        const cpu = new CPU65C816(bus);
        cpu.reset();
        cpu.stepInstruction(); // JSR -> PC=0x7105
        expect(cpu.state.PC).toBe(0x7105);
        cpu.stepInstruction(); // LDA
        expect(cpu.state.A & 0xff).toBe(0x55);
        cpu.stepInstruction(); // RTS -> PC should be 0x7103
        expect(cpu.state.PC).toBe(0x7103);
    });
});
