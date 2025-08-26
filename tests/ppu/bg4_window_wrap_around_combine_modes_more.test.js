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
function writeBG4SolidTile0(bus, charBaseWords) {
    for (let y = 0; y < 8; y++) {
        w8(bus, mmio(0x16), ((charBaseWords + y) & 0xff));
        w8(bus, mmio(0x17), (((charBaseWords + y) >>> 8) & 0xff));
        w8(bus, mmio(0x18), 0xff);
        w8(bus, mmio(0x19), 0x00);
    }
}
function writeBG2SolidTile1(bus) {
    for (let y = 0; y < 8; y++) {
        w8(bus, mmio(0x16), (0x1000 + 16 + y) & 0xff);
        w8(bus, mmio(0x17), ((0x1000 + 16 + y) >>> 8) & 0xff);
        w8(bus, mmio(0x18), 0xff);
        w8(bus, mmio(0x19), 0x00);
    }
}
describe('BG4 window wrap-around with combine modes (AND/XOR/XNOR+invert)', () => {
    function setup(bus) {
        const ppu = bus.getPPU();
        // Brightness
        w8(bus, mmio(0x00), 0x0f);
        // Enable: BG4 main, BG2 subscreen
        w8(bus, mmio(0x2c), 0x08);
        w8(bus, mmio(0x2d), 0x02);
        // BG4 map base 0, BG4 char base 0x0800 words
        w8(bus, mmio(0x0a), 0x00);
        w8(bus, mmio(0x0c), 0x01);
        // BG2 map base word 0x0200, BG2 char base 0x1000 words
        w8(bus, mmio(0x08), 0x04);
        w8(bus, mmio(0x0b), 0x22);
        // Data: BG4 tile0 solid; BG2 tile1 solid
        writeBG4SolidTile0(bus, 0x0800);
        writeBG2SolidTile1(bus);
        // BG4 tilemap entry 0 -> tile 0 pal0; BG2 tilemap @0x0200 -> tile1 pal group1
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x00);
        w8(bus, mmio(0x19), 0x00);
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x02);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x04);
        // Palettes: index1 red; index17 green
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c);
        w8(bus, mmio(0x21), 34);
        w8(bus, mmio(0x22), 0xe0);
        w8(bus, mmio(0x22), 0x03);
        // Color math add-half, mask selects BG4 (bit3)
        w8(bus, mmio(0x31), 0x60 | 0x08);
        return ppu;
    }
    it('AND with wrap-around: A[6..1] & B[7..2] -> blend only at overlap (7,0,1)', () => {
        const bus = mkBus();
        const ppu = setup(bus);
        // A wrap [6..1]; B [7..2]
        w8(bus, mmio(0x26), 0x06);
        w8(bus, mmio(0x27), 0x01);
        w8(bus, mmio(0x28), 0x07);
        w8(bus, mmio(0x29), 0x02);
        // Enable BG4 A|B (W34SEL bits2|3)
        w8(bus, mmio(0x24), 0x0c);
        // CGWSEL: applyInside=1, AND, sub gate on
        w8(bus, mmio(0x30), 0x01 | 0x02 | (1 << 6));
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // Overlap points
        expect(px(7)[0]).toBeGreaterThan(100);
        expect(px(7)[1]).toBeGreaterThan(100);
        expect(px(0)[0]).toBeGreaterThan(100);
        expect(px(0)[1]).toBeGreaterThan(100);
        expect(px(1)[0]).toBeGreaterThan(100);
        expect(px(1)[1]).toBeGreaterThan(100);
        // A-only (x=6) -> no AND blend: pure red
        expect(px(6)[0]).toBeGreaterThan(200);
        expect(px(6)[1]).toBeLessThan(20);
        // Outside both (x=3) -> pure red
        expect(px(3)[0]).toBeGreaterThan(200);
        expect(px(3)[1]).toBeLessThan(20);
    });
    it('XOR with wrap-around: A[6..7] ^ B[0..1] -> blend at 6,7 and 0,1 only', () => {
        const bus = mkBus();
        const ppu = setup(bus);
        // A [6..7], B [0..1]
        w8(bus, mmio(0x26), 0x06);
        w8(bus, mmio(0x27), 0x07);
        w8(bus, mmio(0x28), 0x00);
        w8(bus, mmio(0x29), 0x01);
        // Enable BG4 A|B
        w8(bus, mmio(0x24), 0x0c);
        // XOR combine
        w8(bus, mmio(0x30), 0x01 | 0x02 | (2 << 6));
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // inside XOR true
        expect(px(6)[0]).toBeGreaterThan(100);
        expect(px(6)[1]).toBeGreaterThan(100);
        expect(px(7)[0]).toBeGreaterThan(100);
        expect(px(7)[1]).toBeGreaterThan(100);
        expect(px(0)[0]).toBeGreaterThan(100);
        expect(px(0)[1]).toBeGreaterThan(100);
        expect(px(1)[0]).toBeGreaterThan(100);
        expect(px(1)[1]).toBeGreaterThan(100);
        // outside
        expect(px(3)[0]).toBeGreaterThan(200);
        expect(px(3)[1]).toBeLessThan(20);
    });
    it('XNOR + invert A with wrap-around behaves like XOR on original A/B', () => {
        const bus = mkBus();
        const ppu = setup(bus);
        // A wrap [6..1]; B [1..2]
        w8(bus, mmio(0x26), 0x06);
        w8(bus, mmio(0x27), 0x01);
        w8(bus, mmio(0x28), 0x01);
        w8(bus, mmio(0x29), 0x02);
        // Enable BG4 A|B and invert A (bit6)
        w8(bus, mmio(0x24), 0x0c | 0x40);
        // XNOR
        w8(bus, mmio(0x30), 0x01 | 0x02 | (3 << 6));
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // Effective XOR(orig): blend at A-only {6,7,0} and B-only {2}
        expect(px(6)[0]).toBeGreaterThan(100);
        expect(px(6)[1]).toBeGreaterThan(100);
        expect(px(0)[0]).toBeGreaterThan(100);
        expect(px(0)[1]).toBeGreaterThan(100);
        expect(px(2)[0]).toBeGreaterThan(100);
        expect(px(2)[1]).toBeGreaterThan(100);
        // Overlap at x=1 -> no blend
        expect(px(1)[0]).toBeGreaterThan(200);
        expect(px(1)[1]).toBeLessThan(20);
        // Outside both x=4 -> no blend
        expect(px(4)[0]).toBeGreaterThan(200);
        expect(px(4)[1]).toBeLessThan(20);
    });
});
