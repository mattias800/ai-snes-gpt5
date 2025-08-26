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
describe('HDMA-like mid-scanline changes (simulated by segment rendering)', () => {
    function writeSolidTile(bus) {
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
    it('enables color math halfway through the scanline', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        // Use simplified (legacy) mask semantics for this test: bit5 acts as global enable
        ;
        ppu.cgwStrictMaskMode = false;
        // Brightness and layer enables: BG1 main, BG2 subscreen
        w8(bus, mmio(0x00), 0x0f);
        w8(bus, mmio(0x2c), 0x01);
        w8(bus, mmio(0x2d), 0x02);
        // BG1/BG2 char bases = 0x1000; BG2 map base separate
        w8(bus, mmio(0x0b), 0x22);
        w8(bus, mmio(0x08), 0x04);
        // Tile data
        writeSolidTile(bus);
        // BG1 tile at 0, pal0
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x00);
        // BG2 tile at word 0x0200, pal group 1
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x02);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x04);
        // Palettes: BG1 index1=red, BG2 index17=green
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c);
        w8(bus, mmio(0x21), 34);
        w8(bus, mmio(0x22), 0xe0);
        w8(bus, mmio(0x22), 0x03);
        // First half of line: color math disabled
        w8(bus, mmio(0x31), 0x00);
        const left = renderMainScreenRGBA(ppu, 4, 1);
        // Mid-scanline HDMA effect: enable color math add-half, mask=BG1 only
        w8(bus, mmio(0x31), 0x60 | 0x01);
        const right = renderMainScreenRGBA(ppu, 4, 1);
        // Stitch
        const rgba = new Uint8ClampedArray(8 * 4);
        rgba.set(left, 0);
        rgba.set(right, 16);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1], rgba[x * 4 + 2]];
        // Left half: pure red (no math)
        expect(px(1)[0]).toBeGreaterThan(200);
        expect(px(1)[1]).toBeLessThan(10);
        // Right half: blended (R/G > 0)
        expect(px(5)[0]).toBeGreaterThan(100);
        expect(px(5)[1]).toBeGreaterThan(100);
    });
    it('disables BG1 mid-scanline to reveal BG2 on main', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        // Use simplified (legacy) mask semantics for this test: bit5 acts as global enable
        ;
        ppu.cgwStrictMaskMode = false;
        // Brightness, enable BG1+BG2 main, BG2 subscreen
        w8(bus, mmio(0x00), 0x0f);
        w8(bus, mmio(0x2c), 0x03); // BG1|BG2 main
        w8(bus, mmio(0x2d), 0x02); // BG2 subscreen (not used here)
        // Char bases and BG2 map base
        w8(bus, mmio(0x0b), 0x22);
        w8(bus, mmio(0x08), 0x04);
        writeSolidTile(bus);
        // BG1 tile red at (0,0)
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x00);
        // BG2 tile green at word 0x0200
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x02);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x04);
        // Palettes
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c); // red
        w8(bus, mmio(0x21), 34);
        w8(bus, mmio(0x22), 0xe0);
        w8(bus, mmio(0x22), 0x03); // green
        // Left: BG1+BG2 enabled (BG1 wins)
        w8(bus, mmio(0x2c), 0x03);
        const left = renderMainScreenRGBA(ppu, 4, 1);
        // Right: disable BG1 mid-line, leave BG2 enabled
        w8(bus, mmio(0x2c), 0x02);
        const right = renderMainScreenRGBA(ppu, 4, 1);
        const rgba = new Uint8ClampedArray(8 * 4);
        rgba.set(left, 0);
        rgba.set(right, 16);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1], rgba[x * 4 + 2]];
        // Left half red (BG1)
        expect(px(1)[0]).toBeGreaterThan(200);
        expect(px(1)[1]).toBeLessThan(10);
        // Right half green (BG2)
        expect(px(5)[1]).toBeGreaterThan(200);
    });
    it('disables subscreen mid-scanline to stop blending', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        // Brightness, BG1 main, BG2 subscreen
        w8(bus, mmio(0x00), 0x0f);
        w8(bus, mmio(0x2c), 0x01);
        w8(bus, mmio(0x2d), 0x02);
        // Char bases, BG2 map base
        w8(bus, mmio(0x0b), 0x22);
        w8(bus, mmio(0x08), 0x04);
        writeSolidTile(bus);
        // BG1 tile red
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x00);
        // BG2 tile green at word 0x0200
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x02);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x04);
        // Palettes
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c);
        w8(bus, mmio(0x21), 34);
        w8(bus, mmio(0x22), 0xe0);
        w8(bus, mmio(0x22), 0x03);
        // Color math on
        w8(bus, mmio(0x31), 0x60 | 0x01);
        // Left: subscreen enabled -> blend
        w8(bus, mmio(0x2d), 0x02);
        const left = renderMainScreenRGBA(ppu, 4, 1);
        // Right: subscreen disabled mid-line -> no blend
        w8(bus, mmio(0x2d), 0x00);
        const right = renderMainScreenRGBA(ppu, 4, 1);
        const rgba = new Uint8ClampedArray(8 * 4);
        rgba.set(left, 0);
        rgba.set(right, 16);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // Left blended
        expect(px(1)[0]).toBeGreaterThan(100);
        expect(px(1)[1]).toBeGreaterThan(100);
        // Right uses backdrop as subscreen in our simplified model -> half-red (~123)
        expect(px(5)[0]).toBeGreaterThan(100);
        expect(px(5)[1]).toBeLessThan(10);
    });
});
