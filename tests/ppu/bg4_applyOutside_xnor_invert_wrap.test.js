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
describe('BG4 XNOR+invert applyInside=0 across wrap-around', () => {
    it('applyOutside: blends at overlap and outside-both; no blend at A-only/B-only', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        // Brightness
        w8(bus, mmio(0x00), 0x0f);
        // BG4 main, BG2 sub
        w8(bus, mmio(0x2c), 0x08);
        w8(bus, mmio(0x2d), 0x02);
        // BG4 map 0, char 0x0800; BG2 map 0x0200, char 0x1000
        w8(bus, mmio(0x0a), 0x00);
        w8(bus, mmio(0x0c), 0x01);
        w8(bus, mmio(0x08), 0x04);
        w8(bus, mmio(0x0b), 0x22);
        writeBG4SolidTile0(bus, 0x0800);
        writeBG2SolidTile1(bus);
        // Tilemaps
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x00);
        w8(bus, mmio(0x19), 0x00);
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x02);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x04);
        // Palettes: red and green
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c);
        w8(bus, mmio(0x21), 34);
        w8(bus, mmio(0x22), 0xe0);
        w8(bus, mmio(0x22), 0x03);
        // Color math add-half; mask BG4
        w8(bus, mmio(0x31), 0x60 | 0x08);
        // Windows: A [0..2], B [2..4]; enable BG4 A|B with invert A; applyInside=0, XNOR, sub gate ON
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x02);
        w8(bus, mmio(0x28), 0x02);
        w8(bus, mmio(0x29), 0x04);
        w8(bus, mmio(0x24), 0x0c | 0x40);
        w8(bus, mmio(0x30), 0x00 | 0x02 | (3 << 6));
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // Overlap at x=2 -> blend (applyOutside of XOR region)
        expect(px(2)[0]).toBeGreaterThan(100);
        expect(px(2)[1]).toBeGreaterThan(100);
        // Outside both at x=5 -> blend
        expect(px(5)[0]).toBeGreaterThan(100);
        expect(px(5)[1]).toBeGreaterThan(100);
        // A-only x=1 -> no blend (pure red)
        expect(px(1)[0]).toBeGreaterThan(200);
        expect(px(1)[1]).toBeLessThan(20);
        // B-only x=3 -> no blend
        expect(px(3)[0]).toBeGreaterThan(200);
        expect(px(3)[1]).toBeLessThan(20);
    });
});
