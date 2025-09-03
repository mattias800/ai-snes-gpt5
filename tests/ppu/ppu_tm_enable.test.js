import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
import { renderBG1RegionRGBA } from '../../src/ppu/bg';
const mmio = (reg) => (0x00 << 16) | (0x2100 + (reg & 0xff));
const w8 = (bus, addr, v) => bus.write8(addr, v);
function mkBus() {
    const rom = new Uint8Array(0x20000);
    const cart = new Cartridge({ rom, mapping: 'lorom' });
    return new SNESBus(cart);
}
describe('PPU TM/TS layer enable (main screen BG1)', () => {
    it('disables BG1 output when TM bit0 is 0', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        // Build a visible 8x8 pattern at BG1 char base 0x1000 and map at 0
        w8(bus, mmio(0x07), 0x00);
        w8(bus, mmio(0x0b), 0x02);
        for (let y = 0; y < 8; y++) {
            w8(bus, mmio(0x16), (0x1000 + y) & 0xff);
            w8(bus, mmio(0x17), ((0x1000 + y) >>> 8) & 0xff);
            w8(bus, mmio(0x18), 0xff);
            w8(bus, mmio(0x19), 0x00);
            w8(bus, mmio(0x16), (0x1000 + 8 + y) & 0xff);
            w8(bus, mmio(0x17), ((0x1000 + 8 + y) >>> 8) & 0xff);
            w8(bus, mmio(0x18), 0x00);
            w8(bus, mmio(0x19), 0x00);
        }
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x00);
        w8(bus, mmio(0x19), 0x00);
        // Set palette index 1 to white
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0xff);
        w8(bus, mmio(0x22), 0x7f);
        // Ensure full brightness
        w8(bus, mmio(0x00), 0x0f);
        // Enable BG1 (TM bit0=1) and render, expect >0
        w8(bus, mmio(0x2c), 0x01);
        let rgba = renderBG1RegionRGBA(ppu, 8, 8);
        expect(rgba[0]).toBeGreaterThan(0);
        // Disable all layers (TM=0) and render, expect 0
        w8(bus, mmio(0x2c), 0x00);
        rgba = renderBG1RegionRGBA(ppu, 8, 8);
        expect(rgba[0]).toBe(0);
    });
});
