import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
import { renderMainScreenRGBA } from '../../src/ppu/bg';
const mmio = (reg) => (0x00 << 16) | (0x2100 + (reg & 0xff));
const w8 = (bus, addr, v) => bus.write8(addr, v);
function mkBus() {
    const rom = new Uint8Array(0x20000);
    const cart = new Cartridge({ rom, mapping: 'lorom' });
    return new SNESBus(cart);
}
describe('BG3 2bpp basic render in composer (Mode 1-style)', () => {
    it('BG3 contributes when enabled and BG1/BG2 transparent', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        // Full brightness
        w8(bus, mmio(0x00), 0x0f);
        // Enable only BG3 on TM
        w8(bus, mmio(0x2c), 0x04);
        // BG3 map base 0, char base 0x1000 words (BG3 uses LOW nibble of $210C)
        w8(bus, mmio(0x0c), 0x01);
        // Create a 2bpp tile at BG3 char base: plane0 = 0xFF -> pix=1
        for (let y = 0; y < 8; y++) {
            w8(bus, mmio(0x16), (0x1000 + y) & 0xff);
            w8(bus, mmio(0x17), ((0x1000 + y) >>> 8) & 0xff);
            w8(bus, mmio(0x18), 0xff);
            w8(bus, mmio(0x19), 0x00);
        }
        // BG3 tilemap entry 0 -> tile 0, palette group 0
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x00);
        w8(bus, mmio(0x19), 0x00);
        // Palette: index 1 -> green so it's visible
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0xe0);
        w8(bus, mmio(0x22), 0x03);
        const rgba = renderMainScreenRGBA(ppu, 1, 1);
        expect(rgba[1]).toBe(255);
    });
});
