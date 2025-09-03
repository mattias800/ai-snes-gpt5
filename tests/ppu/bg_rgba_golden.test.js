import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
import { renderBG1RegionRGBA } from '../../src/ppu/bg';
import { fnv1aHex } from '../../src/utils/hash';
const mmio = (reg) => (0x00 << 16) | (0x2100 + (reg & 0xff));
const w8 = (bus, addr, v) => bus.write8(addr, v);
function mkBus() {
    const rom = new Uint8Array(0x20000);
    const cart = new Cartridge({ rom, mapping: 'lorom' });
    return new SNESBus(cart);
}
describe('Golden RGBA hash for BG1 render', () => {
    it('produces stable hash for a simple 16x16 scene', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        // Setup: map base 0x0000, char base 0x1000
        w8(bus, mmio(0x07), 0x00);
        w8(bus, mmio(0x0b), 0x02);
        // Tile: left half red (pix=1), right half 0; rows repeated
        w8(bus, mmio(0x15), 0x00);
        for (let y = 0; y < 8; y++) {
            w8(bus, mmio(0x16), (0x1000 + y) & 0xff);
            w8(bus, mmio(0x17), ((0x1000 + y) >>> 8) & 0xff);
            w8(bus, mmio(0x18), 0xf0);
            w8(bus, mmio(0x19), 0x00);
            w8(bus, mmio(0x16), (0x1000 + 8 + y) & 0xff);
            w8(bus, mmio(0x17), ((0x1000 + 8 + y) >>> 8) & 0xff);
            w8(bus, mmio(0x18), 0x00);
            w8(bus, mmio(0x19), 0x00);
        }
        // Tilemap: 2x2 tiles, palette groups 0,1,2,3
        const pal = (g) => (g & 7) << 10;
        function writeMapWord(wordAddr, value) {
            w8(bus, mmio(0x16), wordAddr & 0xff);
            w8(bus, mmio(0x17), (wordAddr >>> 8) & 0xff);
            w8(bus, mmio(0x18), value & 0xff);
            w8(bus, mmio(0x19), (value >>> 8) & 0xff);
        }
        writeMapWord(0, pal(0));
        writeMapWord(1, pal(1));
        writeMapWord(32, pal(2));
        writeMapWord(33, pal(3));
        // CGRAM colors for palette indices 1,17,33,49
        function writeCGRAMWord(idx, word) {
            w8(bus, mmio(0x21), idx * 2);
            w8(bus, mmio(0x22), word & 0xff);
            w8(bus, mmio(0x22), (word >>> 8) & 0xff);
        }
        writeCGRAMWord(1, 0x001f); // blue
        writeCGRAMWord(17, 0x03e0); // green
        writeCGRAMWord(33, 0x7c00); // red
        writeCGRAMWord(49, 0x7fff); // white
        const rgba = renderBG1RegionRGBA(ppu, 16, 16);
        const hash = fnv1aHex(rgba);
        // Stable golden for this synthetic setup (recorded from current implementation)
        expect(hash).toBe('ecfa86c5');
    });
});
