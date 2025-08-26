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
describe('IRQ and COP vectors (emulation vs native)', () => {
    it('IRQ vectors to $FFFE in emulation mode', () => {
        const bus = new TestMemoryBus();
        const start = 0x4000;
        setReset(bus, start);
        // Set emulation IRQ/BRK vector: $FFFE/$FFFF -> $1234
        w(bus, 0x00, 0xfffe, 0x34);
        w(bus, 0x00, 0xffff, 0x12);
        const cpu = new CPU65C816(bus);
        cpu.reset();
        expect(cpu.state.E).toBe(true);
        cpu.irq();
        expect(cpu.state.PC).toBe(0x1234);
    });
    it('IRQ vectors to $FFEE in native mode', () => {
        const bus = new TestMemoryBus();
        const start = 0x4100;
        setReset(bus, start);
        // Program: XCE (enter native)
        w(bus, 0x00, start + 0, 0xfb);
        // Native IRQ vector $FFEE/$FFEF -> $5678
        w(bus, 0x00, 0xffee, 0x78);
        w(bus, 0x00, 0xffef, 0x56);
        const cpu = new CPU65C816(bus);
        cpu.reset();
        cpu.stepInstruction(); // XCE
        expect(cpu.state.E).toBe(false);
        cpu.irq();
        expect(cpu.state.PC).toBe(0x5678);
    });
    it('IRQ is masked when I flag is set', () => {
        const bus = new TestMemoryBus();
        const start = 0x4200;
        setReset(bus, start);
        // Program: SEI (set I)
        w(bus, 0x00, start + 0, 0x78);
        const cpu = new CPU65C816(bus);
        cpu.reset();
        cpu.stepInstruction(); // SEI
        const pcBefore = cpu.state.PC;
        cpu.irq();
        expect(cpu.state.PC).toBe(pcBefore);
    });
    it('COP vectors to $FFF4 in emulation mode', () => {
        const bus = new TestMemoryBus();
        const start = 0x4300;
        setReset(bus, start);
        // Program: COP
        w(bus, 0x00, start + 0, 0x02);
        // Emulation COP vector $FFF4/$FFF5 -> $3456
        w(bus, 0x00, 0xfff4, 0x56);
        w(bus, 0x00, 0xfff5, 0x34);
        const cpu = new CPU65C816(bus);
        cpu.reset();
        cpu.stepInstruction(); // COP
        expect(cpu.state.PC).toBe(0x3456);
    });
    it('COP vectors to $FFE4 in native mode', () => {
        const bus = new TestMemoryBus();
        const start = 0x4400;
        setReset(bus, start);
        // Program: XCE; COP
        w(bus, 0x00, start + 0, 0xfb);
        w(bus, 0x00, start + 1, 0x02);
        // Native COP vector $FFE4/$FFE5 -> $9ABC
        w(bus, 0x00, 0xffe4, 0xbc);
        w(bus, 0x00, 0xffe5, 0x9a);
        const cpu = new CPU65C816(bus);
        cpu.reset();
        cpu.stepInstruction(); // XCE -> native
        cpu.stepInstruction(); // COP
        expect(cpu.state.E).toBe(false);
        expect(cpu.state.PC).toBe(0x9abc);
    });
});
describe('BRK native vector', () => {
    it('BRK uses $FFE6 in native mode', () => {
        const bus = new TestMemoryBus();
        const start = 0x4500;
        setReset(bus, start);
        // Program: XCE; BRK
        w(bus, 0x00, start + 0, 0xfb);
        w(bus, 0x00, start + 1, 0x00);
        // Native BRK vector $FFE6/$FFE7 -> $2468
        w(bus, 0x00, 0xffe6, 0x68);
        w(bus, 0x00, 0xffe7, 0x24);
        const cpu = new CPU65C816(bus);
        cpu.reset();
        cpu.stepInstruction(); // XCE -> native
        cpu.stepInstruction(); // BRK
        expect(cpu.state.PC).toBe(0x2468);
    });
});
