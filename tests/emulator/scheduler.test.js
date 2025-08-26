import { describe, it, expect } from 'vitest';
import { Emulator } from '../../src/emulator/core';
import { Scheduler } from '../../src/emulator/scheduler';
import { Cartridge } from '../../src/cart/cartridge';
// Program: increment a memory location in WRAM each scanline, stop after BRK.
// We'll simulate by writing STA to WRAM 7E:1000 and increment via ADC #$01.
function buildROM() {
    const rom = new Uint8Array(0x8000);
    let i = 0;
    // LDA #$00
    rom[i++] = 0xa9;
    rom[i++] = 0x00;
    // STA $1000 (WRAM via absolute -> in real SNES, $0000-$1FFF maps to I/O; our bus maps WRAM only in 7E/7F via 24-bit)
    // For test simplicity, write to PPU register instead and break; we only assert scheduler counters advance.
    // BRK
    rom[i++] = 0x00;
    return rom;
}
function makeCartWithVector() {
    const romLoBank = buildROM();
    const rom = new Uint8Array(0x20000);
    rom.set(romLoBank, 0);
    rom[0x7ffc] = 0x00; // low
    rom[0x7ffd] = 0x80; // high
    return new Cartridge({ rom, mapping: 'lorom' });
}
describe('Scheduler: stepScanline and stepFrame counters', () => {
    it('advances PPU scanline and frame counters deterministically', () => {
        const cart = makeCartWithVector();
        const emu = Emulator.fromCartridge(cart);
        emu.reset();
        const sched = new Scheduler(emu, 2);
        const ppu = emu.bus.getPPU();
        expect(ppu.scanline).toBe(0);
        expect(ppu.frame).toBe(0);
        sched.stepScanline();
        expect(ppu.scanline).toBe(1);
        expect(ppu.frame).toBe(0);
        sched.stepFrame();
        expect(ppu.scanline).toBe(0);
        expect(ppu.frame).toBe(1);
    });
});
