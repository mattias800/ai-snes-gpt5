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
describe('Fixed color (COLDATA) add/sub behavior (simplified)', () => {
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
    function setupBG1Main_NoSub(bus) {
        const ppu = bus.getPPU();
        w8(bus, mmio(0x00), 0x0f);
        w8(bus, mmio(0x2c), 0x01); // BG1 main
        w8(bus, mmio(0x2d), 0x00); // no subscreen layers
        w8(bus, mmio(0x0b), 0x22);
        writeSolid(bus);
        // BG1 red tile
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x00);
        // Palette index1 red
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c);
        return ppu;
    }
    it('add-half with fixed color green when subscreen absent', () => {
        const bus = mkBus();
        const ppu = setupBG1Main_NoSub(bus);
        // Enable fixed color mode (use fixed as sub) via CGWSEL bit2 and set fixed Green=31
        w8(bus, mmio(0x30), 0x04);
        w8(bus, mmio(0x32), 0x40 | 31); // set G to 31
        // CGADSUB: enable + half, mask=BG1 (add mode)
        w8(bus, mmio(0x31), 0x60 | 0x01);
        const rgba = renderMainScreenRGBA(ppu, 1, 1);
        expect(rgba[0]).toBeGreaterThan(100); // R reduced by half, still >100
        expect(rgba[1]).toBeGreaterThan(100); // G from fixed contributes
    });
    it('subtract-full with fixed blue when subscreen masked by window', () => {
        const bus = mkBus();
        const ppu = setupBG1Main_NoSub(bus);
        // But set subscreen BG2 present only in window so outside window fixed is used
        // For simplicity, keep no subscreen but use window to demonstrate masked path using fixed
        // Window A [0..3], enable BG1 A; applyInside=0 to affect outside
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x03);
        w8(bus, mmio(0x23), 0x01);
        // CGWSEL: use fixed bit2, applyInside=0 (outside)
        w8(bus, mmio(0x30), 0x04 | 0x00);
        // Set fixed blue = 31
        w8(bus, mmio(0x32), 0x80 | 31);
        // CGADSUB: subtract-full enable, mask=BG1
        w8(bus, mmio(0x31), 0x80 | 0x20 | 0x01);
        const rgba = renderMainScreenRGBA(ppu, 6, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 2]]; // R and B
        // Inside window (x<=3): no fixed used (applyInside=0), so pure red
        expect(px(1)[0]).toBeGreaterThan(200);
        // Outside window (x>=4): subtract blue from red -> blue near 0
        expect(px(5)[1]).toBeLessThan(20);
    });
});
