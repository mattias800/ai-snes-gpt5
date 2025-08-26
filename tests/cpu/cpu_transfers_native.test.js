import { describe, it, expect } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816 } from '../../src/cpu/cpu65c816';
function setReset(bus, addr) {
    bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
    bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}
function w(bus, bank, addr, value) {
    bus.write8(((bank & 0xff) << 16) | (addr & 0xffff), value & 0xff);
}
describe('CPU transfers TCD/TDC/TCS/TSC and JML', () => {
    it('TCD moves A->D and sets ZN on 16-bit result; TDC moves D->A respecting M', () => {
        const bus = new TestMemoryBus();
        const start = 0x6000;
        setReset(bus, start);
        // Program: LDA #$34; TCD; TDC
        w(bus, 0x00, start + 0, 0xa9);
        w(bus, 0x00, start + 1, 0x34);
        w(bus, 0x00, start + 2, 0x5b);
        w(bus, 0x00, start + 3, 0x7b);
        const cpu = new CPU65C816(bus);
        cpu.reset();
        cpu.stepInstruction(); // LDA #$34
        cpu.stepInstruction(); // TCD -> D=0x0034
        expect(cpu.state.D).toBe(0x0034);
        cpu.stepInstruction(); // TDC -> A low=0x34
        expect(cpu.state.A & 0xff).toBe(0x34);
    });
    it('TCS/TSC move between A and S with emulation semantics', () => {
        const bus = new TestMemoryBus();
        const start = 0x6100;
        setReset(bus, start);
        // Program: LDA #$55; TCS; TSC
        w(bus, 0x00, start + 0, 0xa9);
        w(bus, 0x00, start + 1, 0x55);
        w(bus, 0x00, start + 2, 0x1b);
        w(bus, 0x00, start + 3, 0x3b);
        const cpu = new CPU65C816(bus);
        cpu.reset();
        cpu.stepInstruction(); // LDA #$55
        cpu.stepInstruction(); // TCS -> S=0x01_55 in E-mode
        expect(cpu.state.S).toBe(0x0155);
        cpu.stepInstruction(); // TSC -> A low=0x55
        expect(cpu.state.A & 0xff).toBe(0x55);
    });
    it('JML sets PBR and PC to target', () => {
        const bus = new TestMemoryBus();
        const start = 0x6200;
        setReset(bus, start);
        // JML $12:3456
        w(bus, 0x00, start + 0, 0x5c);
        w(bus, 0x00, start + 1, 0x56);
        w(bus, 0x00, start + 2, 0x34);
        w(bus, 0x00, start + 3, 0x12);
        const cpu = new CPU65C816(bus);
        cpu.reset();
        cpu.stepInstruction();
        expect(cpu.state.PBR).toBe(0x12);
        expect(cpu.state.PC).toBe(0x3456);
    });
});
