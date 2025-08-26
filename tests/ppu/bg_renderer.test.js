import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
import { renderBG4bppTilemapIndices } from '../../src/ppu/bg';
const mmio = (reg) => (0x00 << 16) | (0x2100 + (reg & 0xff));
const w8 = (bus, addr, v) => bus.write8(addr, v);
function mkBus() {
    const rom = new Uint8Array(0x20000);
    const cart = new Cartridge({ rom, mapping: 'lorom' });
    return new SNESBus(cart);
}
describe('BG 4bpp tilemap renderer', () => {
    it('renders a 2x2 tilemap using a single 4bpp tile and palette group offset', () => {
        const bus = mkBus();
        const ppu = bus.ppu;
        // Prepare a tile: plane0=0xAA for all rows; others zero => alternating 1/0 bits across each row
        for (let y = 0; y < 8; y++) {
            // low planes at word base + y
            w8(bus, mmio(0x15), 0x00); // step +1 word
            w8(bus, mmio(0x16), (0x100 + y) & 0xff);
            w8(bus, mmio(0x17), ((0x100 + y) >>> 8) & 0xff);
            w8(bus, mmio(0x18), 0xaa);
            w8(bus, mmio(0x19), 0x00);
            // high planes zero at base + 8 + y
            w8(bus, mmio(0x16), (0x100 + 8 + y) & 0xff);
            w8(bus, mmio(0x17), ((0x100 + 8 + y) >>> 8) & 0xff);
            w8(bus, mmio(0x18), 0x00);
            w8(bus, mmio(0x19), 0x00);
        }
        // Build a 32x32 tilemap at 0x000 in VRAM words, set four entries for top-left 2x2 region
        // Entry format: bits 0-9 tile index, 10-12 palette group, 14 X flip, 15 Y flip
        const mapBase = 0x0000;
        const tileBase = 0x0100; // where we wrote tile data
        function writeMapWord(wordAddr, value) {
            w8(bus, mmio(0x15), 0x00);
            w8(bus, mmio(0x16), wordAddr & 0xff);
            w8(bus, mmio(0x17), (wordAddr >>> 8) & 0xff);
            w8(bus, mmio(0x18), value & 0xff);
            w8(bus, mmio(0x19), (value >>> 8) & 0xff);
        }
        // Place tile index 0 with different palette groups and flip flags
        writeMapWord(mapBase + 0, 0 | (0 << 10)); // (0,0) palette 0
        writeMapWord(mapBase + 1, 0 | (1 << 10)); // (1,0) palette 1
        writeMapWord(mapBase + 32, 0 | (2 << 10) | 0x4000); // (0,1) palette 2, X flip
        writeMapWord(mapBase + 33, 0 | (3 << 10) | 0x8000); // (1,1) palette 3, Y flip
        // Render 2x2 tiles (16x16 px) of indices
        const indices = renderBG4bppTilemapIndices(ppu, mapBase, tileBase, 2, 2);
        // Validate palette grouping and flipping at a couple of representative pixels
        const W = 16;
        // Top-left, x=0 y=0 => tile (0,0), palette group 0, pixel from plane0 bit7 => 1
        expect(indices[0]).toBe(1);
        // Top-right, x=8 y=0 => tile (1,0), palette group 1, pixel value 1 + 16*1 = 17
        expect(indices[8]).toBe(17);
        // Bottom-left, x=0 y=8 => tile (0,1), palette group 2, X flipped so leftmost uses bit0 -> 0 + 32 = 32
        expect(indices[8 * W + 0]).toBe(32);
        // Bottom-right, x=8 y=8 => tile (1,1), palette group 3, Y flipped so top row becomes bottom; leftmost bit7 -> 1 + 48 = 49
        expect(indices[8 * W + 8]).toBe(49);
    });
});
