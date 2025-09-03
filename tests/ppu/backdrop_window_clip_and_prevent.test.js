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
function writeSolid(bus) {
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
}
describe('Backdrop window gating and clip-to-black', () => {
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
        w8(bus, mmio(0x0b), 0x02);
        writeSolid(bus);
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x00);
        // CGRAM index1 = green 0x03E0
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0xe0);
        w8(bus, mmio(0x22), 0x03);
        // Enable color math add-half globally (mask=0)
        w8(bus, mmio(0x31), 0x60);
        return ppu;
    }
    it('prevent-math: window A gates backdrop (applyInside=1) without clipping', () => {
        const bus = mkBus();
        const ppu = setupBackdropWithSubGreen(bus);
        // Window A [0..3]; enable backdrop A in WOBJSEL (bit2)
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x03);
        w8(bus, mmio(0x25), 0x04);
        // CGWSEL: applyInside=1, sub gate on, no clip, OR combine
        w8(bus, mmio(0x30), 0x01 | 0x02 | (0 << 6));
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // Inside A -> blend red+green/2
        expect(px(1)[0]).toBeGreaterThan(100);
        expect(px(1)[1]).toBeGreaterThan(100);
        // Outside A -> pure backdrop red
        expect(px(5)[0]).toBeGreaterThan(200);
        expect(px(5)[1]).toBeLessThan(10);
    });
    it('clip-to-black: window A clips backdrop on non-math side', () => {
        const bus = mkBus();
        const ppu = setupBackdropWithSubGreen(bus);
        // Window A [0..3]; enable backdrop A (bit2)
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x03);
        w8(bus, mmio(0x25), 0x04);
        // CGWSEL: applyInside=1, sub gate on, clip bit on
        w8(bus, mmio(0x30), 0x01 | 0x02 | 0x08 | (0 << 6));
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1], rgba[x * 4 + 2]];
        // Inside A -> blend
        expect(px(1)[0]).toBeGreaterThan(100);
        expect(px(1)[1]).toBeGreaterThan(100);
        // Outside A -> clipped to black
        expect(px(5)[0]).toBeLessThan(10);
        expect(px(5)[1]).toBeLessThan(10);
        expect(px(5)[2]).toBeLessThan(10);
    });
    it('invert A for backdrop: applyInside=1 with invert means outside blends', () => {
        const bus = mkBus();
        const ppu = setupBackdropWithSubGreen(bus);
        // A [0..3]; enable backdrop A + invert A -> bits2|6
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x03);
        w8(bus, mmio(0x25), 0x04 | 0x40);
        // applyInside=1, no clip
        w8(bus, mmio(0x30), 0x01 | 0x02 | (0 << 6));
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // Inside A now treated as non-math -> pure red
        expect(px(1)[0]).toBeGreaterThan(200);
        expect(px(1)[1]).toBeLessThan(10);
        // Outside blends
        expect(px(5)[0]).toBeGreaterThan(100);
        expect(px(5)[1]).toBeGreaterThan(100);
    });
});
