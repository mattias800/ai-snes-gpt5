import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
const mmio = (reg) => (0x00 << 16) | (0x2100 + (reg & 0xff));
function w8(bus, addr, v) { bus.write8(addr, v); }
function r8(bus, addr) { return bus.read8(addr); }
// Simple deterministic scheduler test: program writes to PPU over N steps and ensure order
describe('Scheduler (stub): deterministic ordering of CPU->PPU writes via steps', () => {
    it('performs two writes in order when stepping twice', () => {
        const rom = new Uint8Array(0x20000);
        const cart = new Cartridge({ rom, mapping: 'lorom' });
        const bus = new SNESBus(cart);
        // Step 1: write CGADD
        w8(bus, mmio(0x21), 0x10);
        // Step 2: write CGDATA
        w8(bus, mmio(0x22), 0xAB);
        // Verify after two steps, CGRAM byte at 0x10 is AB
        // We'll read back via $213B (increments)
        w8(bus, mmio(0x21), 0x10);
        expect(r8(bus, mmio(0x3b))).toBe(0xAB);
    });
});
