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
describe('OBJ + color math (minimal)', () => {
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
    it('applies add-half when OBJ is main and mask selects OBJ; BG2 used as subscreen', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        // Brightness
        w8(bus, mmio(0x00), 0x0f);
        // Setup BG2 subscreen green pixel at (0,0)
        w8(bus, mmio(0x08), 0x00); // BG2 map base 0
        w8(bus, mmio(0x0b), 0x22); // BG1/BG2 char base 0x1000
        writeSolid4bppTile(bus);
        // BG2 tilemap entry 0 -> tile1, pal group 1 (so CGRAM index 16+pix)
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x04);
        // CGRAM: index 17 = green
        w8(bus, mmio(0x21), 34);
        w8(bus, mmio(0x22), 0xe0);
        w8(bus, mmio(0x22), 0x03);
        // OBJ: char base 0x1000, OAM sprite at (0,0) tile1 group0 -> index1 red
        w8(bus, mmio(0x01), 0x02);
        w8(bus, mmio(0x02), 0x00); // OAM Y
        w8(bus, mmio(0x04), 0x00); // OAM X
        w8(bus, mmio(0x04), 0x00); // tile low (we'll set below)
        w8(bus, mmio(0x04), 0x01); // tile=1
        w8(bus, mmio(0x04), 0x00); // attr group0
        // CGRAM index1 red
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c);
        // Enable OBJ on main, BG2 on subscreen
        w8(bus, mmio(0x2c), 0x10);
        w8(bus, mmio(0x2d), 0x02);
        // CGADSUB: enable + half, mask selects OBJ (bit4)
        w8(bus, mmio(0x31), 0x60 | 0x10);
        const rgba = renderMainScreenRGBA(ppu, 1, 1);
        // Expect roughly (red + green)/2 -> both R and G > 0
        expect(rgba[0]).toBeGreaterThan(100);
        expect(rgba[1]).toBeGreaterThan(100);
        expect(rgba[2]).toBeLessThan(30);
    });
});
