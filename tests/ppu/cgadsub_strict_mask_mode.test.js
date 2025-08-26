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
function writeSolid4bpp(bus) {
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
describe('CGADSUB strict mask mode vs simplified (bit5 global enable)', () => {
    function setupBG1Red_BG2Green(bus) {
        const ppu = bus.getPPU();
        w8(bus, mmio(0x00), 0x0f);
        w8(bus, mmio(0x2c), 0x01); // BG1 main
        w8(bus, mmio(0x2d), 0x02); // BG2 sub
        w8(bus, mmio(0x07), 0x00);
        w8(bus, mmio(0x0b), 0x22);
        w8(bus, mmio(0x08), 0x04);
        writeSolid4bpp(bus);
        // BG1 tile at 0, BG2 tile at word 0x0200
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x00);
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x02);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x04);
        // Palettes: BG1 index1 red, BG2 index17 green
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c);
        w8(bus, mmio(0x21), 34);
        w8(bus, mmio(0x22), 0xe0);
        w8(bus, mmio(0x22), 0x03);
        return ppu;
    }
    it('simplified mode: without bit5 set, math does not apply even if mask selects BG1', () => {
        const bus = mkBus();
        const ppu = setupBG1Red_BG2Green(bus);
        // Ensure strict disabled (default)
        ppu.cgwStrictMaskMode = false;
        // CGADSUB: add-half, enable mask=BG1 only (bit0) but bit5=0
        w8(bus, mmio(0x31), 0x40 | 0x01);
        const rgba = renderMainScreenRGBA(ppu, 1, 1);
        // Expect pure red (no math due to missing bit5)
        expect(rgba[0]).toBeGreaterThan(200);
        expect(rgba[1]).toBeLessThan(10);
    });
    it('strict mask mode: math applies with mask bits even when bit5=0', () => {
        const bus = mkBus();
        const ppu = setupBG1Red_BG2Green(bus);
        // Enable strict mask mode
        ppu.cgwStrictMaskMode = true;
        // CGADSUB: add-half, mask=BG1 only (bit0), bit5=0
        w8(bus, mmio(0x31), 0x40 | 0x01);
        const rgba = renderMainScreenRGBA(ppu, 1, 1);
        // Expect blended (red+green)/2 -> both R and G noticeable
        expect(rgba[0]).toBeGreaterThan(80);
        expect(rgba[1]).toBeGreaterThan(80);
    });
});
