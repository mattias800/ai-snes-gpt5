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
describe('OBJ rendering (minimal)', () => {
    function writeSolid4bppTile(bus) {
        // tile index 1 @ char base 0x1000: plane0=0xFF, rest 0
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
    it('draws a single 8x8 sprite at (0,0) with palette group 0, tile 1', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        w8(bus, mmio(0x00), 0x0f);
        // OBJ char base 0x1000
        w8(bus, mmio(0x01), 0x02);
        writeSolid4bppTile(bus);
        // OAM[0..3]: y=0, x=0, tile=1, attr palette group 0
        w8(bus, mmio(0x02), 0x00);
        w8(bus, mmio(0x04), 0x00);
        w8(bus, mmio(0x04), 0x00);
        w8(bus, mmio(0x04), 0x01);
        w8(bus, mmio(0x04), 0x00);
        // Enable OBJ on main
        w8(bus, mmio(0x2c), 0x10);
        // Palette index 1 = red
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c);
        const rgba = renderMainScreenRGBA(ppu, 1, 1);
        expect(rgba[0]).toBeGreaterThan(200);
        expect(rgba[1]).toBeLessThan(10);
        expect(rgba[2]).toBeLessThan(10);
    });
});
