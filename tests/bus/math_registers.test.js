import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';
const W = (off) => (0x00 << 16) | off;
describe('CPU math registers (mul/div)', () => {
    it('8x8 multiply via $4202/$4203 -> $4216/$4217', () => {
        const cart = new Cartridge({ rom: new Uint8Array(0x20000), mapping: 'lorom' });
        const bus = new SNESBus(cart);
        bus.write8(W(0x4202), 0x12); // A
        bus.write8(W(0x4203), 0x34); // B -> triggers product
        const lo = bus.read8(W(0x4216));
        const hi = bus.read8(W(0x4217));
        const prod = lo | (hi << 8);
        expect(prod).toBe((0x12 * 0x34) & 0xffff); // 0x03A8
    });
    it('16/8 divide via $4204/$4205,$4206 -> $4214/$4215 quotient, $4216/$4217 remainder', () => {
        const cart = new Cartridge({ rom: new Uint8Array(0x20000), mapping: 'lorom' });
        const bus = new SNESBus(cart);
        // Dividend 0x1234, divisor 0x12 = 4660 / 18 = 258 r 14
        bus.write8(W(0x4204), 0x34);
        bus.write8(W(0x4205), 0x12);
        bus.write8(W(0x4206), 0x12); // trigger division
        const ql = bus.read8(W(0x4214));
        const qh = bus.read8(W(0x4215));
        const rl = bus.read8(W(0x4216));
        const rh = bus.read8(W(0x4217));
        const q = ql | (qh << 8);
        const r = rl | (rh << 8);
        expect(q).toBe(Math.floor(0x1234 / 0x12));
        expect(r).toBe(0x1234 % 0x12);
    });
    it('divide by zero sets quotient=0xFFFF and remainder=dividend', () => {
        const cart = new Cartridge({ rom: new Uint8Array(0x20000), mapping: 'lorom' });
        const bus = new SNESBus(cart);
        bus.write8(W(0x4204), 0x78);
        bus.write8(W(0x4205), 0x56); // dividend 0x5678
        bus.write8(W(0x4206), 0x00); // divisor 0
        const q = bus.read8(W(0x4214)) | (bus.read8(W(0x4215)) << 8);
        const r = bus.read8(W(0x4216)) | (bus.read8(W(0x4217)) << 8);
        expect(q).toBe(0xffff);
        expect(r).toBe(0x5678);
    });
});
