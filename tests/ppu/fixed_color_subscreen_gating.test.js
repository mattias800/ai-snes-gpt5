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
describe('Subscreen fixed color gating with window masks over backdrop sub', () => {
    function setupBG1Red_OBJoff(bus) {
        const ppu = bus.getPPU();
        w8(bus, mmio(0x00), 0x0f);
        // BG1 main
        w8(bus, mmio(0x2c), 0x01);
        // No subscreen layers -> backdrop subscreen
        w8(bus, mmio(0x2d), 0x00);
        // BG1 char/map
        w8(bus, mmio(0x07), 0x00);
        w8(bus, mmio(0x0b), 0x02);
        // solid tile1
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
        // tilemap -> tile1 pal0
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x00);
        // CGRAM index1 red; backdrop CGRAM index0 = black
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c);
        w8(bus, mmio(0x21), 0);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x00);
        return ppu;
    }
    it('sub gate masks subscreen to backdrop when fixed mode off (applyInside=1)', () => {
        const bus = mkBus();
        const ppu = setupBG1Red_OBJoff(bus);
        // Window A [0..3] gating subscreen backdrop via WOBJSEL bits2
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x03);
        w8(bus, mmio(0x25), 0x04);
        // CGWSEL: applyInside=1, sub gate on, fixed mode OFF
        w8(bus, mmio(0x30), 0x01 | 0x02);
        // Enable color math add-half, mask BG1
        w8(bus, mmio(0x31), 0x60 | 0x01);
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // Inside A -> blend with backdrop (black) -> still red but darker
        expect(px(1)[0]).toBeGreaterThan(80);
        expect(px(1)[0]).toBeLessThan(200);
        // Outside A -> main math still applies with unmasked subscreen=backdrop -> also darker than pure red
        expect(px(5)[0]).toBeGreaterThan(80);
        expect(px(5)[0]).toBeLessThan(200);
    });
    it('sub gate masks to fixed color when fixed mode ON', () => {
        const bus = mkBus();
        const ppu = setupBG1Red_OBJoff(bus);
        // Window A [0..3] for subscreen backdrop
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x03);
        w8(bus, mmio(0x25), 0x04);
        // CGWSEL: applyInside=1, sub gate on, FIXED mode ON
        w8(bus, mmio(0x30), 0x01 | 0x02 | 0x04);
        // Fixed color = green
        w8(bus, mmio(0x32), 0x40 | 31);
        // Enable color math add-half, mask BG1
        w8(bus, mmio(0x31), 0x60 | 0x01);
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // Inside A -> blend with fixed green -> both R and G noticeable
        expect(px(1)[0]).toBeGreaterThan(80);
        expect(px(1)[1]).toBeGreaterThan(80);
        // Outside A -> math still applies with fixed subscreen (no sub present), so still blended
        expect(px(5)[0]).toBeGreaterThan(80);
        expect(px(5)[1]).toBeGreaterThan(20);
    });
});
