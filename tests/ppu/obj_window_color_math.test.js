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
describe('OBJ windowed color math (WOBJSEL, simplified)', () => {
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
    function setupOBJMain_BG2Sub(bus) {
        // Brightness
        w8(bus, mmio(0x00), 0x0f);
        // Enable OBJ main, BG2 subscreen
        w8(bus, mmio(0x2c), 0x10);
        w8(bus, mmio(0x2d), 0x02);
        // OBJ char base 0x1000
        w8(bus, mmio(0x01), 0x02);
        writeSolid4bppTile(bus);
        // One sprite at (0,0) tile 1, pal group 0
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
        // Palettes: OBJ index1=red, BG2 index17=green
        w8(bus, mmio(0x21), 2);
        w8(bus, mmio(0x22), 0x00);
        w8(bus, mmio(0x22), 0x7c);
        w8(bus, mmio(0x21), 34);
        w8(bus, mmio(0x22), 0xe0);
        w8(bus, mmio(0x22), 0x03);
        // Color math on: enable+half, mask selects OBJ
        w8(bus, mmio(0x31), 0x60 | 0x10);
    }
    it('applyInside=1: blends inside window A when WOBJSEL enables A', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        setupOBJMain_BG2Sub(bus);
        // Window A [0..3], WOBJSEL A enable
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x03);
        w8(bus, mmio(0x25), 0x01);
        // CGWSEL applyInside=1
        w8(bus, mmio(0x30), 0x01);
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // Inside A (x=1) -> blend
        expect(px(1)[0]).toBeGreaterThan(100);
        expect(px(1)[1]).toBeGreaterThan(100);
        // Outside A (x=5) -> no blend (red)
        expect(px(5)[0]).toBeGreaterThan(200);
        expect(px(5)[1]).toBeLessThan(10);
    });
    it('applyInside=0: blends outside window A when WOBJSEL enables A', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        setupOBJMain_BG2Sub(bus);
        // Window A [0..3], enable A
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x03);
        w8(bus, mmio(0x25), 0x01);
        // CGWSEL applyInside=0 (invert)
        w8(bus, mmio(0x30), 0x00);
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // Inside A (x=1) -> no blend (red)
        expect(px(1)[0]).toBeGreaterThan(200);
        expect(px(1)[1]).toBeLessThan(10);
        // Outside A (x=5) -> blend
        expect(px(5)[0]).toBeGreaterThan(100);
        expect(px(5)[1]).toBeGreaterThan(100);
    });
    it('invert A (bit4) on WOBJSEL flips window sense for OBJ', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        setupOBJMain_BG2Sub(bus);
        // A [0..3], enable A and invert A -> 0x01 | 0x10 = 0x11
        w8(bus, mmio(0x26), 0x00);
        w8(bus, mmio(0x27), 0x03);
        w8(bus, mmio(0x25), 0x11);
        // applyInside=1
        w8(bus, mmio(0x30), 0x01);
        const rgba = renderMainScreenRGBA(ppu, 8, 1);
        const px = (x) => [rgba[x * 4], rgba[x * 4 + 1]];
        // With invert, inside A behaves as outside; thus no blend at x=1, blend at x=5
        expect(px(1)[0]).toBeGreaterThan(200);
        expect(px(1)[1]).toBeLessThan(10);
        expect(px(5)[0]).toBeGreaterThan(100);
        expect(px(5)[1]).toBeGreaterThan(100);
    });
});
