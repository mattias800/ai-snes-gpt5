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
describe.skip('OBJ groundwork: color math with OBJ main', () => {
    it('skeleton: when OBJ enabled in TM and mask includes OBJ, color math should apply (once OBJ rendering is implemented)', () => {
        const bus = mkBus();
        const ppu = bus.getPPU();
        // For now, just assert renderer returns something and this is a placeholder for when OBJ is supported.
        w8(bus, mmio(0x00), 0x0f);
        w8(bus, mmio(0x2c), 0x10); // TM bit4 = OBJ
        w8(bus, mmio(0x31), 0x60 | 0x10); // enable+half, mask selects OBJ (bit4)
        const rgba = renderMainScreenRGBA(ppu, 1, 1);
        expect(rgba.length).toBe(4);
    });
});
