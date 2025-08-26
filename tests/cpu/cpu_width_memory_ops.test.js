import { describe, it, expect } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816 } from '../../src/cpu/cpu65c816';
function setReset(bus, addr) {
    // Set 00:FFFC/FFFD to addr (little endian)
    bus.write8((0x00 << 16) | 0xfffc, addr & 0xff);
    bus.write8((0x00 << 16) | 0xfffd, (addr >>> 8) & 0xff);
}
function writeProgram(bus, bank, pc, bytes) {
    let a = (bank << 16) | pc;
    for (const b of bytes)
        bus.write8(a++, b & 0xff);
}
function r8(bus, addr24) { return bus.read8(addr24); }
describe('CPU width-sensitive memory ops (LDA/STA/CMP abs 16-bit)', () => {
    it('handles 16-bit A with REP M=0 and absolute addressing', () => {
        const bus = new TestMemoryBus();
        const start = 0x8000;
        setReset(bus, start);
        // Data location $00:1234
        const dataLoAddr = (0x00 << 16) | 0x1234;
        const dataHiAddr = (0x00 << 16) | 0x1235;
        // Program at $00:8000
        // CLC; XCE; REP #$30; LDA #$BEEF; STA $1234; LDA #$0000; LDA $1234; CMP $1234; BRK
        writeProgram(bus, 0x00, start, [
            0x18,
            0xfb,
            0xc2, 0x30,
            0xa9, 0xef, 0xbe,
            0x8d, 0x34, 0x12,
            0xa9, 0x00, 0x00,
            0xad, 0x34, 0x12,
            0xcd, 0x34, 0x12,
            0x00,
        ]);
        const cpu = new CPU65C816(bus);
        cpu.reset();
        // Execute exactly 9 instructions
        for (let i = 0; i < 9; i++)
            cpu.stepInstruction();
        // Verify 16-bit store occurred
        expect(r8(bus, dataLoAddr)).toBe(0xef);
        expect(r8(bus, dataHiAddr)).toBe(0xbe);
        // After LDA $1234 and CMP $1234, Z should be set and C set (equal)
        const P = cpu.state.P;
        expect((P & 0x02) !== 0).toBe(true); // Z
        expect((P & 0x01) !== 0).toBe(true); // C
    });
});
