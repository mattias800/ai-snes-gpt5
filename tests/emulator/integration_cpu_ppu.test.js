import { describe, it, expect } from 'vitest';
import { Emulator } from '../../src/emulator/core';
import { Cartridge } from '../../src/cart/cartridge';
// Program: set CGADD ($2121) to 0x20, write CGDATA ($2122) 0x77
// We'll place the program at reset vector 0x8000 in bank 0.
// Opcodes used: LDA #imm (A), STA abs (A->MMIO), BRK (to terminate -> will throw)
function buildROM() {
    const rom = new Uint8Array(0x8000); // 32KiB LoROM bank
    // Program at 0x8000 (mapped by LoROM at bank 0)
    // LDA #$20
    rom[0x0000] = 0xa9;
    rom[0x0001] = 0x20;
    // STA $2121 (low byte $21, high $21)
    rom[0x0002] = 0x8d;
    rom[0x0003] = 0x21;
    rom[0x0004] = 0x21;
    // LDA #$77
    rom[0x0005] = 0xa9;
    rom[0x0006] = 0x77;
    // STA $2122
    rom[0x0007] = 0x8d;
    rom[0x0008] = 0x22;
    rom[0x0009] = 0x21;
    // BRK (0x00) to end
    rom[0x000a] = 0x00;
    return rom;
}
function makeCartWithResetVector() {
    const romLoBank = buildROM();
    // Create a 128KiB ROM and put program at first 32KiB (LoROM mapping: bank 0, $8000)
    const rom = new Uint8Array(0x20000);
    rom.set(romLoBank, 0);
    // Write reset vector at $00:FFFC/FFFD to point to $8000
    // Since our bus maps LoROM at bank 0x00 $8000->ROM[0]
    const cart = new Cartridge({ rom, mapping: 'lorom' });
    // We can't pre-fill bus memory here; Emulator reset fetches from bus which maps from cartridge.
    // We'll simulate vector by overwriting SNESBus read in tests? Simpler: Put vector in ROM at 0x7FFC/0x7FFD for LoROM mapping.
    // Our simple bus maps ROM via LoROM only at $8000-$FFFF; vector fetch occurs at $FFFC/$FFFD ($00 bank), which will read ROM offset 0x7FFC-0x8000=-4 -> wrap at % length.
    // To ensure correct PC=0x8000, also fill last 2 bytes of first bank accordingly in rom offset 0x7FFC and 0x7FFD.
    rom[0x7ffc] = 0x00; // low
    rom[0x7ffd] = 0x80; // high
    return { cart, romLoBank };
}
describe('Integration: CPU writes to PPU via bus', () => {
    it('executes a tiny program that sets CGADD and writes one CGDATA byte', () => {
        const { cart } = makeCartWithResetVector();
        const emu = Emulator.fromCartridge(cart);
        emu.reset();
        // Step LDA #$20, STA $2121, LDA #$77, STA $2122
        emu.stepInstruction();
        emu.stepInstruction();
        emu.stepInstruction();
        emu.stepInstruction();
        // Verify PPU CGRAM byte at 0x20 is 0x77
        const ppu = emu.bus.getPPU();
        // Read back through PPU port semantics
        // Set CGADD=0x20
        emu.bus.write8(0x002121, 0x20);
        const val = emu.bus.read8(0x00213b);
        expect(val).toBe(0x77);
    });
});
