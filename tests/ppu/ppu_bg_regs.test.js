import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
const mmio = (reg) => (0x00 << 16) | (0x2100 + (reg & 0xff));
const w8 = (bus, addr, v) => bus.write8(addr, v);
function mkBus() {
    const rom = new Uint8Array(0x20000);
    const cart = new Cartridge({ rom, mapping: 'lorom' });
    return new SNESBus(cart);
}
describe('PPU BG1 base and scroll registers', () => {
    it('computes BG1 map/char base from $2107/$210B and latches BG1HOFS/BG1VOFS from two writes', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        // BG1SC: set base to 0x0800 bytes -> words = 0x0400
        w8(bus, mmio(0x07), 0x08);
        expect(ppu.bg1MapBaseWord).toBe(0x0400);
        // BG12NBA: set BG1 char base to nibble 2 -> 2 * 0x800 words = 0x1000 words
        w8(bus, mmio(0x0b), 0x20);
        expect(ppu.bg1CharBaseWord).toBe(0x1000);
        // BG1HOFS: write low then high (only bits 0-2 used)
        w8(bus, mmio(0x0d), 0x34);
        w8(bus, mmio(0x0d), 0x01);
        expect(ppu.bg1HOfs).toBe(((0x01 & 0x07) << 8) | 0x34);
        // BG1VOFS: write low then high
        w8(bus, mmio(0x0e), 0x56);
        w8(bus, mmio(0x0e), 0x02);
        expect(ppu.bg1VOfs).toBe(((0x02 & 0x07) << 8) | 0x56);
    });
});
