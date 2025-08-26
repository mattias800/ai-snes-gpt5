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
describe('OBJ color math subtract (full and half)', () => {
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
    function setupOBJWhite_main_BG2Blue_sub(bus) {
        // Brightness full
        w8(bus, mmio(0x00), 0x0f);
        // Enable OBJ on main, BG2 on subscreen
        w8(bus, mmio(0x2c), 0x10);
        w8(bus, mmio(0x2d), 0x02);
        // OBJ char base 0x1000, write solid tile
        w8(bus, mmio(0x01), 0x02);
        writeSolid4bppTile(bus);
        // One sprite at (0,0), tile=1, group 0
        w8(bus, mmio(0x02), 0x00);
        w8(bus, mmio(0x04), 0x00); // X
        w8(bus, mmio(0x04), 0x00); // tile low
        w8(bus, mmio(0x04), 0x01); // tile=1
        w8(bus, mmio(0x04), 0x00); // attr
        // BG2: char base 0x1000, map base 0x0000, tile 1 pal group 1
        w8(bus, mmio(0x0b), 0x22);
        w8(bus, mmio(0x08), 0x00);
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x04);
        // CGRAM: OBJ index1 = white (0x7FFF); BG2 index17 = blue (0x001F)
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0xff);
        w8(bus, mmio(0x22), 0x7f);
        w8(bus, mmio(0x21), 34);
        w8(bus, mmio(0x22), 0x1f);
        w8(bus, mmio(0x22), 0x00);
    }
    it('subtract-full: white OBJ - blue subscreen -> RG high, B ~ 0', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        setupOBJWhite_main_BG2Blue_sub(bus);
        // CGADSUB: subtract (bit7), enable (bit5), mask selects OBJ (bit4), full (no half)
        w8(bus, mmio(0x31), 0x80 | 0x20 | 0x10);
        const rgba = renderMainScreenRGBA(ppu, 1, 1);
        expect(rgba[0]).toBeGreaterThan(200); // R high
        expect(rgba[1]).toBeGreaterThan(200); // G high
        expect(rgba[2]).toBeLessThan(20); // B near 0
    });
    it('subtract-half: same but half -> RG mid (~>100), B ~ 0', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        setupOBJWhite_main_BG2Blue_sub(bus);
        // CGADSUB: subtract + enable + mask OBJ + half
        w8(bus, mmio(0x31), 0x80 | 0x20 | 0x10 | 0x40);
        const rgba = renderMainScreenRGBA(ppu, 1, 1);
        expect(rgba[0]).toBeGreaterThan(100);
        expect(rgba[0]).toBeLessThan(200);
        expect(rgba[1]).toBeGreaterThan(100);
        expect(rgba[1]).toBeLessThan(200);
        expect(rgba[2]).toBeLessThan(20);
    });
});
