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
describe('Window edges for combine modes (AND/XOR/XNOR)', () => {
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
    function setup(bus) {
        const ppu = bus.getPPU();
        w8(bus, mmio(0x00), 0x0f);
        w8(bus, mmio(0x2c), 0x01); // BG1 main
        w8(bus, mmio(0x2d), 0x02); // BG2 sub
        w8(bus, mmio(0x0b), 0x22);
        w8(bus, mmio(0x08), 0x04);
        writeSolid(bus);
        // BG1 red, BG2 green
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x00);
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x02);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x04);
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c);
        w8(bus, mmio(0x21), 34);
        w8(bus, mmio(0x22), 0xe0);
        w8(bus, mmio(0x22), 0x03);
        // Color math add-half, mask=BG1
        w8(bus, mmio(0x31), 0x60 | 0x01);
        return ppu;
    }
    it('AND combine includes overlap boundary (x=3) when A=[2..3], B=[3..4]', () => {
        const bus = mkBus();
        const ppu = setup(bus);
        // A [2..3], B [3..4]
        w8(bus, mmio(0x26), 0x02);
        w8(bus, mmio(0x27), 0x03);
        w8(bus, mmio(0x28), 0x03);
        w8(bus, mmio(0x29), 0x04);
        w8(bus, mmio(0x23), 0x03); // BG1 A|B
        w8(bus, mmio(0x30), 0x01 | (1 << 6)); // AND
        const rgba = renderMainScreenRGBA(ppu, 6, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        expect(px(3)[0]).toBeGreaterThan(100);
        expect(px(3)[1]).toBeGreaterThan(100); // boundary included
        expect(px(2)[0]).toBeGreaterThan(200);
        expect(px(2)[1]).toBeLessThan(10);
        expect(px(4)[0]).toBeGreaterThan(200);
        expect(px(4)[1]).toBeLessThan(10);
    });
    it('XOR combine excludes overlap boundary (x=4) when A=[2..4], B=[4..6]', () => {
        const bus = mkBus();
        const ppu = setup(bus);
        // A [2..4], B [4..6]
        w8(bus, mmio(0x26), 0x02);
        w8(bus, mmio(0x27), 0x04);
        w8(bus, mmio(0x28), 0x04);
        w8(bus, mmio(0x29), 0x06);
        w8(bus, mmio(0x23), 0x03);
        w8(bus, mmio(0x30), 0x01 | (2 << 6)); // XOR
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // Boundaries x=2,6 inside one window -> blend; x=4 inside both -> no blend for XOR
        expect(px(2)[0]).toBeGreaterThan(100);
        expect(px(2)[1]).toBeGreaterThan(100);
        expect(px(4)[0]).toBeGreaterThan(200);
        expect(px(4)[1]).toBeLessThan(10);
        expect(px(6)[0]).toBeGreaterThan(100);
        expect(px(6)[1]).toBeGreaterThan(100);
    });
    it('XNOR combine includes overlap boundary (x=4) and outside boundary (x=7)', () => {
        const bus = mkBus();
        const ppu = setup(bus);
        // A [2..4], B [4..6]
        w8(bus, mmio(0x26), 0x02);
        w8(bus, mmio(0x27), 0x04);
        w8(bus, mmio(0x28), 0x04);
        w8(bus, mmio(0x29), 0x06);
        w8(bus, mmio(0x23), 0x03);
        w8(bus, mmio(0x30), 0x01 | (3 << 6)); // XNOR
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // x=4 overlap -> blend; x=7 outside both -> blend
        expect(px(4)[0]).toBeGreaterThan(100);
        expect(px(4)[1]).toBeGreaterThan(100);
        expect(px(7)[0]).toBeGreaterThan(100);
        expect(px(7)[1]).toBeGreaterThan(100);
    });
});
