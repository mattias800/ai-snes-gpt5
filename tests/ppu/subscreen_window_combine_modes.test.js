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
describe('Subscreen window combine modes (CGWSEL bit1, applyInside=1)', () => {
    function writeSolid4bppTile(bus) {
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
    function setupBG1Main_BG2Sub(bus) {
        const ppu = bus.getPPU();
        // Brightness
        w8(bus, mmio(0x00), 0x0f);
        // Main BG1, Sub BG2
        w8(bus, mmio(0x2c), 0x01);
        w8(bus, mmio(0x2d), 0x02);
        // BG2 map base 0x0400 bytes to avoid overlap; BG1 map base 0
        w8(bus, mmio(0x07), 0x00);
        w8(bus, mmio(0x08), 0x04);
        // Char bases 0x1000
        w8(bus, mmio(0x0b), 0x22);
        writeSolid4bppTile(bus);
        // BG1 tile at 0 -> tile1 pal0 (red main)
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x00);
        // BG2 tile at word 0x0200 -> tile1 pal group1 (green sub)
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x02);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x04);
        // Palettes: index1 red, index17 green
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
    it('OR combine: blend where subscreen window A or B', () => {
        const bus = mkBus();
        const ppu = setupBG1Main_BG2Sub(bus);
        // Windows A [0..1], B [3..4]
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x01);
        w8(bus, mmio(0x28), 0x03);
        w8(bus, mmio(0x29), 0x04);
        // Enable BG2 A and B for subscreen gating via W12SEL bits2/3
        w8(bus, mmio(0x23), 0x0c);
        // CGWSEL: applyInside=1 and subscreen gate=1; combine OR (00)
        w8(bus, mmio(0x30), 0x03 | (0 << 6));
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // Expect blend at x=0,1 and x=3,4; where subscreen masked (x=2,5), math occurs against backdrop -> half red
        expect(px(0)[0]).toBeGreaterThan(100);
        expect(px(0)[1]).toBeGreaterThan(100);
        expect(px(2)[0]).toBeGreaterThan(100);
        expect(px(2)[1]).toBeLessThan(10);
        expect(px(3)[0]).toBeGreaterThan(100);
        expect(px(3)[1]).toBeGreaterThan(100);
    });
    it('AND combine: blend only where A and B overlap', () => {
        const bus = mkBus();
        const ppu = setupBG1Main_BG2Sub(bus);
        // A [1..2], B [2..3] -> overlap at x=2
        w8(bus, mmio(0x26), 0x01);
        w8(bus, mmio(0x27), 0x02);
        w8(bus, mmio(0x28), 0x02);
        w8(bus, mmio(0x29), 0x03);
        w8(bus, mmio(0x23), 0x0c);
        w8(bus, mmio(0x30), 0x03 | (1 << 6));
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        expect(px(2)[0]).toBeGreaterThan(100);
        expect(px(2)[1]).toBeGreaterThan(100);
        // At x=1 and x=3 subscreen masked -> half red
        expect(px(1)[0]).toBeGreaterThan(100);
        expect(px(1)[1]).toBeLessThan(10);
        expect(px(3)[0]).toBeGreaterThan(100);
        expect(px(3)[1]).toBeLessThan(10);
    });
    it('XOR combine: blend where A xor B', () => {
        const bus = mkBus();
        const ppu = setupBG1Main_BG2Sub(bus);
        // A [0..2], B [2..4]
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x02);
        w8(bus, mmio(0x28), 0x02);
        w8(bus, mmio(0x29), 0x04);
        w8(bus, mmio(0x23), 0x0c);
        w8(bus, mmio(0x30), 0x03 | (2 << 6));
        const rgba = renderMainScreenRGBA(ppu, 6, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        expect(px(1)[0]).toBeGreaterThan(100);
        expect(px(1)[1]).toBeGreaterThan(100);
        // At x=2 subscreen masked -> half red
        expect(px(2)[0]).toBeGreaterThan(100);
        expect(px(2)[1]).toBeLessThan(10);
        expect(px(4)[0]).toBeGreaterThan(100);
        expect(px(4)[1]).toBeGreaterThan(100);
    });
    it('XNOR combine: blend where both-in or both-out', () => {
        const bus = mkBus();
        const ppu = setupBG1Main_BG2Sub(bus);
        // A [0..2], B [2..4]
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x02);
        w8(bus, mmio(0x28), 0x02);
        w8(bus, mmio(0x29), 0x04);
        w8(bus, mmio(0x23), 0x0c);
        w8(bus, mmio(0x30), 0x03 | (3 << 6));
        const rgba = renderMainScreenRGBA(ppu, 7, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // x=2 (both) and x=5 (outside both) blended; x=1 (A-only) subscreen masked -> half red
        expect(px(2)[0]).toBeGreaterThan(100);
        expect(px(2)[1]).toBeGreaterThan(100);
        expect(px(5)[0]).toBeGreaterThan(100);
        expect(px(5)[1]).toBeGreaterThan(100);
        expect(px(1)[0]).toBeGreaterThan(100);
        expect(px(1)[1]).toBeLessThan(10);
    });
});
