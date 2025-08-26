import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
function mkBus() {
    const rom = new Uint8Array(0x20000);
    const cart = new Cartridge({ rom, mapping: 'lorom' });
    return new SNESBus(cart);
}
describe('Controller via $4016 on bus', () => {
    it('writes strobe and reads bits', () => {
        const bus = mkBus();
        // Access controller indirectly via writes to $4016
        // There's no direct setter, but we can simulate by accessing controller1 through typed any cast in tests if needed.
        // For now, verify that read without setting any buttons yields high (1) after 12 reads.
        // Strobe sequence
        bus.write8(0x00004016, 1);
        bus.write8(0x00004016, 0);
        const bits = [];
        for (let i = 0; i < 12; i++)
            bits.push(bus.read8(0x00004016) & 1);
        // Default no buttons pressed => all zeros until we hit beyond range (we return 1)
        // Our implementation returns 1 beyond range, but first 12 should be 0
        for (let i = 0; i < 12; i++)
            expect(bits[i]).toBe(0);
    });
});
