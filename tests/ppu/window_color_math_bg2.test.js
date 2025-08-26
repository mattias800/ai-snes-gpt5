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
describe('Windowed color math for BG2 (simplified)', () => {
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
    it('applies color math only inside window when applyInside=1 and W12SEL enables BG2', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        // Brightness
        w8(bus, mmio(0x00), 0x0f);
        // BG2 main, BG1 subscreen
        w8(bus, mmio(0x2c), 0x02);
        w8(bus, mmio(0x2d), 0x01);
        // BG1/BG2 char bases 0x1000 and BG2 map base separate
        w8(bus, mmio(0x0b), 0x22);
        w8(bus, mmio(0x08), 0x04); // BG2SC = 0x0400 bytes
        // Write solid 4bpp tile
        writeSolid4bppTile(bus);
        // BG2 tile solid red at (0,0)
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x02);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x00);
        // BG1 tile solid green at (0,0), palette group 1 at word 0x0200
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x04);
        // Palettes: BG2 index1 red, BG1 index17 green
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c);
        w8(bus, mmio(0x21), 34);
        w8(bus, mmio(0x22), 0xe0);
        w8(bus, mmio(0x22), 0x03);
        // Window: [0..3]; enable BG2 gating via W12SEL bit2 (A on BG2)
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x03);
        w8(bus, mmio(0x23), 0x04);
        // CGWSEL applyInside=1; CGADSUB enable+half, mask=BG2
        w8(bus, mmio(0x30), 0x01);
        w8(bus, mmio(0x31), 0x60 | 0x02);
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // Inside window (x<=3): expect blended (R and G > 0)
        expect(px(1)[0]).toBeGreaterThan(100);
        expect(px(1)[1]).toBeGreaterThan(100);
        // Outside window (x>=4): expect pure red (no blend)
        expect(px(5)[0]).toBeGreaterThan(200);
        expect(px(5)[1]).toBeLessThan(10);
    });
    it('applies color math only outside window when applyInside=0 for BG2', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        // Brightness
        w8(bus, mmio(0x00), 0x0f);
        // BG2 main, BG1 subscreen
        w8(bus, mmio(0x2c), 0x02);
        w8(bus, mmio(0x2d), 0x01);
        w8(bus, mmio(0x0b), 0x22);
        w8(bus, mmio(0x08), 0x04);
        writeSolid4bppTile(bus);
        // BG2 tile solid red
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x02);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x00);
        // BG1 tile solid green (pal group 1)
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x04);
        // Palettes
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c);
        w8(bus, mmio(0x21), 34);
        w8(bus, mmio(0x22), 0xe0);
        w8(bus, mmio(0x22), 0x03);
        // Window A [0..3], enable BG2 gating
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x03);
        w8(bus, mmio(0x23), 0x04);
        // CGWSEL applyInside=0; CGADSUB enable+half, mask=BG2
        w8(bus, mmio(0x30), 0x00);
        w8(bus, mmio(0x31), 0x60 | 0x02);
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // Inside window (x<=3): expect pure red (no blend)
        expect(px(1)[0]).toBeGreaterThan(200);
        expect(px(1)[1]).toBeLessThan(10);
        // Outside window (x>=4): expect blended (R and G > 0)
        expect(px(5)[0]).toBeGreaterThan(100);
        expect(px(5)[1]).toBeGreaterThan(100);
    });
});
