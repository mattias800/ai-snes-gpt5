import { describe, it, expect } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816 } from '../../src/cpu/cpu65c816';
function setReset(bus, addr) {
    bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
    bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}
describe('CPU width, XCE, and memory abs', () => {
    it('REP/SEP and XCE affect E/M/X correctly in E-mode constraints', () => {
        const bus = new TestMemoryBus();
        const start = 0x5200;
        setReset(bus, start);
        // Program: SEP #$00; REP #$10; REP #$20; XCE
        // In E-mode, M/X remain forced to 1 after updates
        const prog = [
            0xe2, 0x00, // SEP #$00 (no-op)
            0xc2, 0x10, // REP #$10 clear X flag -> but E forces X=1
            0xc2, 0x20, // REP #$20 clear M flag -> but E forces M=1
            0xfb // XCE: swap C and E (E<-C, C<-oldE)
        ];
        for (let i = 0; i < prog.length; i++)
            bus.write8((0x00 << 16) | (start + i), prog[i]);
        const cpu = new CPU65C816(bus);
        cpu.reset();
        const p0 = cpu.state.P;
        cpu.stepInstruction(); // SEP #$00
        cpu.stepInstruction(); // REP #$10 (X cleared but forced back to 1 by E)
        expect((cpu.state.P & 16 /* Flag.X */) !== 0).toBe(true);
        cpu.stepInstruction(); // REP #$20 (M cleared but forced back to 1 by E)
        expect((cpu.state.P & 32 /* Flag.M */) !== 0).toBe(true);
        const oldE = cpu.state.E;
        const oldC = (cpu.state.P & 1 /* Flag.C */) !== 0;
        cpu.stepInstruction(); // XCE
        // Now E == oldC, and C == oldE
        expect(cpu.state.E).toBe(oldC);
        const cNow = (cpu.state.P & 1 /* Flag.C */) !== 0;
        expect(cNow).toBe(oldE);
    });
    it('LDA abs/STA abs with DBR=0 reads/writes via CPU bus', () => {
        const bus = new TestMemoryBus();
        const start = 0x5300;
        setReset(bus, start);
        // Program: LDA #$AA; STA $1234; LDA #$00; LDA $1234
        const prog = [
            0xa9, 0xaa,
            0x8d, 0x34, 0x12,
            0xa9, 0x00,
            0xad, 0x34, 0x12
        ];
        for (let i = 0; i < prog.length; i++)
            bus.write8((0x00 << 16) | (start + i), prog[i]);
        const cpu = new CPU65C816(bus);
        cpu.reset();
        cpu.stepInstruction(); // LDA #$AA
        cpu.stepInstruction(); // STA $1234
        expect(bus.read8(0x00001234)).toBe(0xaa);
        cpu.stepInstruction(); // LDA #$00
        expect(cpu.state.A & 0xff).toBe(0x00);
        cpu.stepInstruction(); // LDA $1234
        expect(cpu.state.A & 0xff).toBe(0xaa);
    });
});
