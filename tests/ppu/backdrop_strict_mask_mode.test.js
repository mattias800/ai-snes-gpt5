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
describe('Backdrop strict mask mode with mask=0 and bit5=0', () => {
    function setupBackdropWithSubGreen(bus) {
        const ppu = bus.getPPU();
        // Full brightness
        w8(bus, mmio(0x00), 0x0f);
        // No main layers -> backdrop only
        w8(bus, mmio(0x2c), 0x00);
        // Subscreen BG1 green
        w8(bus, mmio(0x2d), 0x01);
        // Backdrop color (CGRAM index 0) = red 0x7C00
        w8(bus, mmio(0x21), 0);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c);
        // BG1 green tile on subscreen
        w8(bus, mmio(0x07), 0x00);
        w8(bus, mmio(0x0b), 0x20);
        for (let y = 0; y < 8; y++) {
            w8(bus, mmio(0x16), (0x1000 + 16 + y) & 0xff);
            w8(bus, mmio(0x17), ((0x1000 + 16 + y) >>> 8) & 0xff);
            w8(bus, mmio(0x18), 0xff);
            w8(bus, mmio(0x19), 0x00);
            w8(bus, mmio(0x16), (0x1000 + 16 + 8 + y) & 0xff);
            w8(bus, mmio(0x17), ((0x1000 + 16 + 8 + y) >>> 8) & 0xff);
            w8(bus, mmio(0x18), 0x00);
            w8(bus, mmio(0x19), 0x00);
        }
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x00);
        return ppu;
    }
    it('simplified default (strict=false): with bit5=0 and mask=0, no math applies (pure red)', () => {
        const bus = mkBus();
        const ppu = setupBackdropWithSubGreen(bus);
        ppu.cgwStrictMaskMode = false;
        // CGADSUB: half add, mask=0 (global), but bit5=0 (no enable in simplified)
        w8(bus, mmio(0x31), 0x40);
        const rgba = renderMainScreenRGBA(ppu, 1, 1);
        // Expect pure red from backdrop
        expect(rgba[0]).toBeGreaterThan(200);
        expect(rgba[1]).toBeLessThan(10);
    });
    it('strict=true: with bit5=0 and mask=0, math applies (blend red+green)', () => {
        const bus = mkBus();
        const ppu = setupBackdropWithSubGreen(bus);
        ppu.cgwStrictMaskMode = true;
        // Set CGRAM index1 (BG1) to green so subscreen contributes
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0xe0);
        w8(bus, mmio(0x22), 0x03);
        w8(bus, mmio(0x31), 0x40); // half add, mask=0
        const rgba = renderMainScreenRGBA(ppu, 1, 1);
        // Expect both R and G visible (blended)
        expect(rgba[0]).toBeGreaterThan(100);
        expect(rgba[1]).toBeGreaterThan(100);
    });
});
