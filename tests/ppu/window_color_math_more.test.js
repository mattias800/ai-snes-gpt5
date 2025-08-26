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
describe('Window gating for BG3 and OBJ (simplified)', () => {
    function writeBG3Solid(bus) {
        // Write 2bpp tile 1 at char base 0x1000: plane0=0xFF rows, plane1=0
        for (let y = 0; y < 8; y++) {
            w8(bus, mmio(0x16), (0x1000 + y * 2) & 0xff);
            w8(bus, mmio(0x17), ((0x1000 + y * 2) >>> 8) & 0xff);
            w8(bus, mmio(0x18), 0xff);
            w8(bus, mmio(0x19), 0x00);
            w8(bus, mmio(0x16), (0x1000 + y * 2 + 1) & 0xff);
            w8(bus, mmio(0x17), ((0x1000 + y * 2 + 1) >>> 8) & 0xff);
            w8(bus, mmio(0x18), 0x00);
            w8(bus, mmio(0x19), 0x00);
        }
    }
    function writeOBJSolid(bus) {
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
    it('BG3 color math gated by W34SEL bit0 and window range', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        w8(bus, mmio(0x00), 0x0f);
        // Enable BG3 main, BG2 subscreen
        w8(bus, mmio(0x2c), 0x04);
        w8(bus, mmio(0x2d), 0x02);
        // Setup BG3 char/map base and tile 1 solid at (0,0), pal group 0
        w8(bus, mmio(0x0c), 0x20); // BG3 char base 0x1000
        writeBG3Solid(bus);
        w8(bus, mmio(0x09), 0x00); // BG3 map base 0
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x00);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x00);
        // BG2 for subscreen green
        w8(bus, mmio(0x0b), 0x22); // BG2 char base 0x1000
        w8(bus, mmio(0x08), 0x04); // BG2 map base 0x0400 bytes
        // Write solid 4bpp tile 1
        writeOBJSolid(bus);
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x02);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x04);
        // Palettes: BG3 index1=red, BG2 index17=green
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c);
        w8(bus, mmio(0x21), 34);
        w8(bus, mmio(0x22), 0xe0);
        w8(bus, mmio(0x22), 0x03);
        // Window: [0..3], enable BG3 gating via W34SEL bit0
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x03);
        w8(bus, mmio(0x24), 0x01);
        // CGWSEL inside=1; CGADSUB enable+half, mask=BG3 (bit2)
        w8(bus, mmio(0x30), 0x01);
        w8(bus, mmio(0x31), 0x60 | 0x04);
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1], rgba[x * 4 + 2]];
        expect(px(1)[0]).toBeGreaterThan(100);
        expect(px(1)[1]).toBeGreaterThan(100);
        expect(px(5)[0]).toBeGreaterThan(200);
        expect(px(5)[1]).toBeLessThan(10);
    });
    it('OBJ color math gated by WOBJSEL bit0 and window range', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        w8(bus, mmio(0x00), 0x0f);
        // Enable OBJ main, BG2 subscreen
        w8(bus, mmio(0x2c), 0x10);
        w8(bus, mmio(0x2d), 0x02);
        // OBJ char base 0x1000, OAM sprite at (0,0) tile1 group0
        w8(bus, mmio(0x01), 0x02);
        writeOBJSolid(bus);
        w8(bus, mmio(0x02), 0x00);
        w8(bus, mmio(0x04), 0x00);
        w8(bus, mmio(0x04), 0x00);
        w8(bus, mmio(0x04), 0x01);
        w8(bus, mmio(0x04), 0x00);
        // BG2 subscreen green tile
        w8(bus, mmio(0x0b), 0x22);
        w8(bus, mmio(0x08), 0x04);
        w8(bus, mmio(0x16), 0x00);
        w8(bus, mmio(0x17), 0x02);
        w8(bus, mmio(0x18), 0x01);
        w8(bus, mmio(0x19), 0x04);
        // Palettes: OBJ index1=red, BG2 index17=green
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c);
        w8(bus, mmio(0x21), 34);
        w8(bus, mmio(0x22), 0xe0);
        w8(bus, mmio(0x22), 0x03);
        // Window: [0..3], enable OBJ gating via WOBJSEL bit0
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x03);
        w8(bus, mmio(0x25), 0x01);
        // CGWSEL inside=1; CGADSUB enable+half, mask=OBJ (bit4)
        w8(bus, mmio(0x30), 0x01);
        w8(bus, mmio(0x31), 0x60 | 0x10);
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1], rgba[x * 4 + 2]];
        expect(px(1)[0]).toBeGreaterThan(100);
        expect(px(1)[1]).toBeGreaterThan(100);
        expect(px(5)[0]).toBeGreaterThan(200);
        expect(px(5)[1]).toBeLessThan(10);
    });
});
