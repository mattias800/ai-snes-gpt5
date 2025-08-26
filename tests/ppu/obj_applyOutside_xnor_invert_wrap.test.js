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
function writeObjSolidTile(bus) {
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
describe('OBJ XNOR+invert applyInside=0 across wrap-around', () => {
    it('applyOutside: blends at overlap and outside-both; no blend at A-only/B-only', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        // Brightness
        w8(bus, mmio(0x00), 0x0f);
        // OBJ main, BG2 sub
        w8(bus, mmio(0x2c), 0x10);
        w8(bus, mmio(0x2d), 0x02);
        // OBJ: char base 0x1000, one sprite at 0,0
        w8(bus, mmio(0x01), 0x02);
        writeObjSolidTile(bus);
        w8(bus, mmio(0x02), 0x00);
        w8(bus, mmio(0x04), 0x00);
        w8(bus, mmio(0x04), 0x00);
        w8(bus, mmio(0x04), 0x01);
        w8(bus, mmio(0x04), 0x00);
        // BG2 green at map 0, char 0x1000
        w8(bus, mmio(0x0b), 0x22);
        w8(bus, mmio(0x08), 0x00);
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x04);
        // Palettes: OBJ red, BG2 green
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c);
        w8(bus, mmio(0x21), 34);
        w8(bus, mmio(0x22), 0xe0);
        w8(bus, mmio(0x22), 0x03);
        // Color math add-half; mask=OBJ
        w8(bus, mmio(0x31), 0x60 | 0x10);
        // Windows: A [0..2], B [2..4]; enable OBJ A|B + invert A; applyInside=0, XNOR, sub gate ON
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x02);
        w8(bus, mmio(0x28), 0x02);
        w8(bus, mmio(0x29), 0x04);
        w8(bus, mmio(0x25), 0x03 | 0x10);
        w8(bus, mmio(0x30), 0x00 | 0x02 | (3 << 6));
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // Overlap x=2 -> blend
        expect(px(2)[0]).toBeGreaterThan(100);
        expect(px(2)[1]).toBeGreaterThan(100);
        // Outside both x=5 -> blend
        expect(px(5)[0]).toBeGreaterThan(100);
        expect(px(5)[1]).toBeGreaterThan(100);
        // A-only x=1 -> no blend
        expect(px(1)[0]).toBeGreaterThan(200);
        expect(px(1)[1]).toBeLessThan(20);
        // B-only x=3 -> no blend
        expect(px(3)[0]).toBeGreaterThan(200);
        expect(px(3)[1]).toBeLessThan(20);
    });
});
