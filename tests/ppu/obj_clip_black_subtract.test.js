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
describe('OBJ clip-to-black with subtract mode', () => {
    it('applyInside=1: outside non-math side is black even with subtract-half', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        // Brightness
        w8(bus, mmio(0x00), 0x0f);
        // OBJ main, BG2 subscreen
        w8(bus, mmio(0x2c), 0x10);
        w8(bus, mmio(0x2d), 0x02);
        // OBJ setup: char base 0x1000, sprite at (0,0)
        w8(bus, mmio(0x01), 0x02);
        writeObjSolidTile(bus);
        w8(bus, mmio(0x02), 0x00);
        w8(bus, mmio(0x04), 0x00);
        w8(bus, mmio(0x04), 0x00);
        w8(bus, mmio(0x04), 0x01);
        w8(bus, mmio(0x04), 0x00);
        // BG2: green on subscreen
        w8(bus, mmio(0x0b), 0x22);
        w8(bus, mmio(0x08), 0x00);
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x04);
        // Palettes: OBJ red (index1), BG2 green (index17)
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c);
        w8(bus, mmio(0x21), 34);
        w8(bus, mmio(0x22), 0xe0);
        w8(bus, mmio(0x22), 0x03);
        // CGADSUB: subtract + half + enable; mask OBJ
        w8(bus, mmio(0x31), 0xe0 | 0x10);
        // Window A [0..3] for OBJ; applyInside=1, subGate on, clip-to-black on
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x03);
        w8(bus, mmio(0x25), 0x01);
        w8(bus, mmio(0x30), 0x01 | 0x02 | 0x08 | (0 << 6));
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1], rgba[x * 4 + 2]];
        // Inside -> (red - green)/2 => R still present, G low
        expect(px(1)[0]).toBeGreaterThan(80);
        expect(px(1)[1]).toBeLessThan(30);
        // Outside -> clipped to black
        expect(px(5)[0]).toBeLessThan(10);
        expect(px(5)[1]).toBeLessThan(10);
        expect(px(5)[2]).toBeLessThan(10);
    });
});
