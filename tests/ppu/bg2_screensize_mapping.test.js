import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
import { renderBG2RegionIndices } from '../../src/ppu/bg';
const mmio = (reg) => (0x00 << 16) | (0x2100 + (reg & 0xff));
const w8 = (bus, addr, v) => bus.write8(addr, v);
function mkBus() {
    const rom = new Uint8Array(0x20000);
    const cart = new Cartridge({ rom, mapping: 'lorom' });
    return new SNESBus(cart);
}
describe('BG2 screen size mapping (64x32 and 32x64)', () => {
    it('applies 0x400 and 0x800 word offsets when crossing 32-tile boundaries on BG2', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        // Set BG2 screen size to 64x64 (size=3) to test both width/height flags, char base 0x1000
        w8(bus, mmio(0x08), 0x03); // BG2SC size=3
        w8(bus, mmio(0x0b), 0x02); // BG2 char base words 0x1000
        // Prepare tile 0 (all pixels value 1) and tile 1 (all pixels 0)
        const base = 0x1000;
        function writeTileFill(tileIndex, byte) {
            const wordBase = base + tileIndex * 16;
            for (let y = 0; y < 8; y++) {
                w8(bus, mmio(0x16), (wordBase + y) & 0xff);
                w8(bus, mmio(0x17), ((wordBase + y) >>> 8) & 0xff);
                w8(bus, mmio(0x18), byte);
                w8(bus, mmio(0x19), 0x00);
                w8(bus, mmio(0x16), (wordBase + 8 + y) & 0xff);
                w8(bus, mmio(0x17), ((wordBase + 8 + y) >>> 8) & 0xff);
                w8(bus, mmio(0x18), 0x00);
                w8(bus, mmio(0x19), 0x00);
            }
        }
        writeTileFill(0, 0xff); // all ones
        writeTileFill(1, 0x00); // all zeros
        // Fill quadrant tilemaps at 0, +0x400, +0x800, +0xC00 word offsets
        function writeMapWord(wordAddr, value) {
            w8(bus, mmio(0x16), wordAddr & 0xff);
            w8(bus, mmio(0x17), (wordAddr >>> 8) & 0xff);
            w8(bus, mmio(0x18), value & 0xff);
            w8(bus, mmio(0x19), (value >>> 8) & 0xff);
        }
        function fillBlock(baseWord, tileIndex) {
            for (let ty = 0; ty < 32; ty++) {
                for (let tx = 0; tx < 32; tx++) {
                    writeMapWord(baseWord + ty * 32 + tx, tileIndex);
                }
            }
        }
        fillBlock(0x0000, 0); // top-left -> ones
        fillBlock(0x0400, 1); // top-right -> zeros
        fillBlock(0x0800, 1); // bottom-left -> zeros
        fillBlock(0x0c00, 0); // bottom-right -> ones
        // Sample centers of quadrants by setting scroll
        function sampleAtTile(tileX, tileY) {
            ppu.bg2HOfs = tileX * 8;
            ppu.bg2VOfs = tileY * 8;
            const idx = renderBG2RegionIndices(ppu, 8, 8);
            return idx[0];
        }
        expect(sampleAtTile(16, 16)).toBe(1); // TL -> ones
        expect(sampleAtTile(48, 16)).toBe(0); // TR -> zeros (crossed +0x400)
        expect(sampleAtTile(16, 48)).toBe(0); // BL -> zeros (crossed +0x800)
        expect(sampleAtTile(48, 48)).toBe(1); // BR -> ones (crossed +0xC00)
    });
});
