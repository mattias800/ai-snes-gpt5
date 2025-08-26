import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
function mkCart(bytes) {
    const rom = new Uint8Array(bytes);
    return new Cartridge({ rom, mapping: 'lorom' });
}
function w8(bus, addr, v) { bus.write8(addr, v); }
function r8(bus, addr) { return bus.read8(addr); }
// Helpers for $21xx addressing
const mmio = (reg) => (0x00 << 16) | (0x2100 + (reg & 0xff));
describe('PPU ports: VRAM/CGRAM/OAM basic behaviors', () => {
    it('VRAM write/read with VMAIN increment after high (bit7=0) and step=+1 word', () => {
        const bus = new SNESBus(mkCart(0x20000));
        // Set VMAIN: bit7=0 (inc after high), step=0 (+1 word)
        w8(bus, mmio(0x15), 0x00);
        // Set VADDR to 0x1234
        w8(bus, mmio(0x16), 0x34);
        w8(bus, mmio(0x17), 0x12);
        // Write word 0xBEEF at 0x1234 via $2118/$2119
        w8(bus, mmio(0x18), 0xEF); // low
        w8(bus, mmio(0x19), 0xBE); // high -> inc occurs here (bit7=0)
        // Next address should be 0x1235
        // Write next word 0xCAFE
        w8(bus, mmio(0x18), 0xFE);
        w8(bus, mmio(0x19), 0xCA);
        // Read back via $2139/$213A with same VADDR
        w8(bus, mmio(0x16), 0x34);
        w8(bus, mmio(0x17), 0x12);
        const low1 = r8(bus, mmio(0x39));
        const high1 = r8(bus, mmio(0x3a));
        const low2 = r8(bus, mmio(0x39));
        const high2 = r8(bus, mmio(0x3a));
        expect(low1).toBe(0xEF);
        expect(high1).toBe(0xBE);
        expect(low2).toBe(0xFE);
        expect(high2).toBe(0xCA);
    });
    it('CGRAM write increments CGADD automatically on $2122 writes', () => {
        const bus = new SNESBus(mkCart(0x20000));
        // Set CGADD to 0x10
        w8(bus, mmio(0x21), 0x10);
        w8(bus, mmio(0x22), 0xAA);
        w8(bus, mmio(0x22), 0xBB);
        // Read back via $213B (auto-increment on read)
        // Reset CGADD to 0x10 first
        w8(bus, mmio(0x21), 0x10);
        expect(r8(bus, mmio(0x3b))).toBe(0xAA);
        expect(r8(bus, mmio(0x3b))).toBe(0xBB);
    });
    it('OAM writes via $2102/$2103 set address; $2104 writes increment address', () => {
        const bus = new SNESBus(mkCart(0x20000));
        // Set OAM address to 0x020
        w8(bus, mmio(0x02), 0x20);
        w8(bus, mmio(0x03), 0x00);
        // Write three bytes
        w8(bus, mmio(0x04), 0x11);
        w8(bus, mmio(0x04), 0x22);
        w8(bus, mmio(0x04), 0x33);
        // Reset OAM address and read back via $2138 (auto-increment on read)
        w8(bus, mmio(0x02), 0x20);
        w8(bus, mmio(0x03), 0x00);
        expect(r8(bus, mmio(0x38))).toBe(0x11);
        expect(r8(bus, mmio(0x38))).toBe(0x22);
        expect(r8(bus, mmio(0x38))).toBe(0x33);
    });
});
