import { describe, it, expect } from 'vitest';
import { CPU65C816 } from '../../src/cpu/cpu65c816';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
function writeResetVector(bus, addr) {
    // Write little-endian PC to bank 0x00 @ 0xFFFC/0xFFFD in 24-bit space
    bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
    bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}
describe('CPU65C816 reset and NOP', () => {
    it('resets to emulation mode, sets SP high byte to 0x01, sets M and X flags, and jumps to vector', () => {
        const bus = new TestMemoryBus();
        writeResetVector(bus, 0x8000);
        // Place a NOP at reset vector (bank 0x00, address 0x8000)
        bus.write8((0x00 << 16) | 0x8000, 0xea);
        const cpu = new CPU65C816(bus);
        cpu.reset();
        expect(cpu.state.E).toBe(true);
        expect((cpu.state.P & 32 /* Flag.M */) !== 0).toBe(true);
        expect((cpu.state.P & 16 /* Flag.X */) !== 0).toBe(true);
        expect((cpu.state.P & 8 /* Flag.D */) === 0).toBe(true);
        expect(cpu.state.S >>> 8).toBe(0x01);
        expect(cpu.state.PBR).toBe(0x00);
        expect(cpu.state.PC).toBe(0x8000);
        // Execute NOP and ensure PC advanced
        cpu.stepInstruction();
        expect(cpu.state.PC).toBe(0x8001);
    });
    it('throws on unimplemented opcode (WDM $42)', () => {
        const bus = new TestMemoryBus();
        writeResetVector(bus, 0x1234);
        bus.write8((0x00 << 16) | 0x1234, 0x42); // WDM (not implemented)
        const cpu = new CPU65C816(bus);
        cpu.reset();
        expect(() => cpu.stepInstruction()).toThrowError(/Unimplemented opcode/);
    });
});
