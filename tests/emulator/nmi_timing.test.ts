import { describe, it, expect } from 'vitest';
import { Cartridge } from '../../src/cart/cartridge';
import { Emulator } from '../../src/emulator/core';
import { Scheduler } from '../../src/emulator/scheduler';

function makeCart(): Cartridge {
  // 128KiB ROM, contents don't matter for this timing test
  const rom = new Uint8Array(0x20000);
  // Set reset vector ($00:FFFC/FFFD) to $8000 so PC starts there
  rom[0x7ffc] = 0x00; // low byte
  rom[0x7ffd] = 0x80; // high byte
  return new Cartridge({ rom, mapping: 'lorom' });
}

const RDNMI = 0x00004210;
const HVBJOY = 0x00004212;
const NMITIMEN = 0x00004200;

describe('NMI timing: single pulse at VBlank start (223->224)', () => {
  it('pulses once per frame and latches $4210; $4212 reflects VBlank state', () => {
    const cart = makeCart();
    const emu = Emulator.fromCartridge(cart);
    emu.reset();

    // Enable NMI (bit7 of $4200)
    emu.bus.write8(NMITIMEN, 0x80);

    const sched = new Scheduler(emu, 2); // small IPS just to exercise the loop

    const ppu = emu.bus.getPPU();
    expect(ppu.scanline).toBe(0);

    // Step to just before VBlank: scanline 223
    for (let i = 0; i < 223; i++) sched.stepScanline();
    expect(ppu.scanline).toBe(223);
    // Not in VBlank yet
    expect(emu.bus.read8(HVBJOY) & 0x80).toBe(0x00);
    // No NMI latched yet
    expect(emu.bus.read8(RDNMI) & 0x80).toBe(0x00);

    // Next scanline enters VBlank (224) -> should pulse NMI exactly once
    sched.stepScanline();
    expect(ppu.scanline).toBe(224);
    // In VBlank now
    expect(emu.bus.read8(HVBJOY) & 0x80).toBe(0x80);
    // RDNMI should be set once, and clear on read
    expect(emu.bus.read8(RDNMI) & 0x80).toBe(0x80);
    expect(emu.bus.read8(RDNMI) & 0x80).toBe(0x00);

    // Advance within VBlank; should not re-pulse
    sched.stepScanline();
    expect(emu.bus.read8(RDNMI) & 0x80).toBe(0x00);

    // Finish frame
    for (let i = ppu.scanline; i < 262; i++) sched.stepScanline();
    expect(ppu.scanline).toBe(0);

    // Next frame: step to VBlank start again and verify another single pulse
    for (let i = 0; i < 224; i++) sched.stepScanline();
    expect(ppu.scanline).toBe(224);
    expect(emu.bus.read8(RDNMI) & 0x80).toBe(0x80);
  });
});
