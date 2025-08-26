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
describe('Mixed main/sub: XNOR combine and invert flags', () => {
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
        // Color math add-half, mask=BG1; subscreen gate on
        w8(bus, mmio(0x31), 0x60 | 0x01);
        return ppu;
    }
    it('XNOR combine: blend at overlap and outside both (applyInside=1)', () => {
        const bus = mkBus();
        const ppu = setup(bus);
        // A [0..2], B [2..4]
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x02);
        w8(bus, mmio(0x28), 0x02);
        w8(bus, mmio(0x29), 0x04);
        // Enable BG1 A|B and BG2 A|B
        w8(bus, mmio(0x23), 0x03 | 0x0c);
        // applyInside=1, XNOR, sub gate on
        w8(bus, mmio(0x30), 0x01 | 0x02 | (3 << 6));
        const rgba = renderMainScreenRGBA(ppu, 7, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // Overlap at x=2
        expect(px(2)[0]).toBeGreaterThan(100);
        expect(px(2)[1]).toBeGreaterThan(100);
        // Outside both at x=5 -> also blend due to XNOR
        expect(px(5)[0]).toBeGreaterThan(100);
        expect(px(5)[1]).toBeGreaterThan(100);
        // In A-only region x=1 -> no blend (pure red)
        expect(px(1)[0]).toBeGreaterThan(200);
        expect(px(1)[1]).toBeLessThan(10);
    });
    it('Invert A on both: with OR, applyInside=1 blends outside A', () => {
        const bus = mkBus();
        const ppu = setup(bus);
        // A [0..3]
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x03);
        // Enable only A for both BG1 and BG2, with invert A on both (bit4 for each selector)
        w8(bus, mmio(0x23), 0x01 | 0x10 | 0x04 | 0x40); // BG1 A+invA, BG2 A+invA
        // applyInside=1, OR, sub gate on
        w8(bus, mmio(0x30), 0x01 | 0x02 | (0 << 6));
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // Inside A (x=1) -> inverted means no math; expect red
        expect(px(1)[0]).toBeGreaterThan(200);
        expect(px(1)[1]).toBeLessThan(10);
        // Outside A (x=5) -> inverted means math region -> blend
        expect(px(5)[0]).toBeGreaterThan(100);
        expect(px(5)[1]).toBeGreaterThan(100);
    });
});
