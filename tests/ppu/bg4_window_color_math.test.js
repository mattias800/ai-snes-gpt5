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
    // 2bpp tile index 0 at char base: plane0=0xFF rows, plane1=0x00
    for (let y = 0; y < 8; y++) {
        w8(bus, mmio(0x16), ((charBaseWords + y) & 0xff));
        w8(bus, mmio(0x17), (((charBaseWords + y) >>> 8) & 0xff));
        w8(bus, mmio(0x18), 0xff);
        w8(bus, mmio(0x19), 0x00);
    }
}
describe('BG4 window gating (2bpp like BG3) with color math', () => {
    it('applyInside=1: window A enables blend over BG4 main', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        // Full brightness
        w8(bus, mmio(0x00), 0x0f);
        // Enable BG4 main and BG2 subscreen
        w8(bus, mmio(0x2c), 0x08);
        w8(bus, mmio(0x2d), 0x02);
        // BG4 map base 0 ($210A), BG34NBA ($210C) low nibble for BG4 char base
        w8(bus, mmio(0x0a), 0x00); // map base 0
        w8(bus, mmio(0x0c), 0x01); // BG4 char base nibble=1 -> 0x0800 words; BG3 nibble=0
        // BG2 map/char for subscreen green; place BG2 tilemap at word 0x0200 to avoid overlap with BG4 tilemap
        w8(bus, mmio(0x08), 0x04); // map base offset -> word 0x0200
        w8(bus, mmio(0x0b), 0x22);
        // Make BG4 tile 0 solid index 1
        writeBG4SolidTile0(bus, 0x0800);
        // BG4 tilemap entry 0 -> tile 0, pal group 0
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x00);
        w8(bus, mmio(0x19), 0x00);
        // BG2 tilemap entry at word 0x0200 -> tile 1 pal group 1 (solid will be index1 too)
        for (let y = 0; y < 8; y++) {
            w8(bus, mmio(0x16), (0x1000 + 16 + y) & 0xff);
            w8(bus, mmio(0x17), ((0x1000 + 16 + y) >>> 8) & 0xff);
            w8(bus, mmio(0x18), 0xff);
            w8(bus, mmio(0x19), 0x00);
        }
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x02);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x04);
        // CGRAM: index1 red, index17 green
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c);
        w8(bus, mmio(0x21), 34);
        w8(bus, mmio(0x22), 0xe0);
        w8(bus, mmio(0x22), 0x03);
        // Window A [0..3], W34SEL enables BG4 A (bit2)
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x03);
        w8(bus, mmio(0x24), 0x04);
        // CGWSEL: applyInside=1, OR combine; subscreen gating on
        w8(bus, mmio(0x30), 0x01 | 0x02 | (0 << 6));
        // Color math enable add-half global (mask=0)
        w8(bus, mmio(0x31), 0x60);
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // Inside window -> blend
        expect(px(1)[0]).toBeGreaterThan(100);
        expect(px(1)[1]).toBeGreaterThan(100);
        // Outside -> pure BG4 red
        expect(px(5)[0]).toBeGreaterThan(200);
        expect(px(5)[1]).toBeLessThan(10);
    });
});
