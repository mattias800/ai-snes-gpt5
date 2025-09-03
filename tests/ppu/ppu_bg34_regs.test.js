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
describe('PPU BG3/BG4 base and scroll registers', () => {
    it('computes BG3/BG4 map/char bases and latches HOFS/VOFS from two writes', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        // BG3SC ($2109): set base to 0x0400 bytes -> words = 0x0200
        w8(bus, mmio(0x09), 0x04);
        expect(ppu.bg3MapBaseWord).toBe(0x0200);
        // BG4SC ($210A): set base to 0x1000 bytes -> words = 0x0800
        w8(bus, mmio(0x0a), 0x10);
        expect(ppu.bg4MapBaseWord).toBe(0x0800);
        // BG34NBA ($210C) hardware: BG3=LOW nibble, BG4=HIGH nibble; unit=0x2000 bytes (0x1000 words)
        // Write 0xB7: BG3 nibble=0x7 -> 0x7000 words; BG4 nibble=0xB -> 0xB000 words
        w8(bus, mmio(0x0c), 0xb7);
        expect(ppu.bg3CharBaseWord).toBe(0x7000);
        expect(ppu.bg4CharBaseWord).toBe(0xb000);
        // BG3HOFS/VOFS $2111/$2112
        w8(bus, mmio(0x11), 0x12);
        w8(bus, mmio(0x11), 0x03);
        expect(ppu.bg3HOfs).toBe(((0x03 & 0x07) << 8) | 0x12);
        w8(bus, mmio(0x12), 0x34);
        w8(bus, mmio(0x12), 0x05);
        expect(ppu.bg3VOfs).toBe(((0x05 & 0x07) << 8) | 0x34);
        // BG4HOFS/VOFS $2113/$2114
        w8(bus, mmio(0x13), 0x56);
        w8(bus, mmio(0x13), 0x01);
        expect(ppu.bg4HOfs).toBe(((0x01 & 0x07) << 8) | 0x56);
        w8(bus, mmio(0x14), 0x78);
        w8(bus, mmio(0x14), 0x02);
        expect(ppu.bg4VOfs).toBe(((0x02 & 0x07) << 8) | 0x78);
    });
});
