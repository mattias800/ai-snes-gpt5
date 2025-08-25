import { describe, it, expect } from 'vitest';
import { detectMapping, parseHeader } from '../../src/cart/header';

function mkRom(size: number): Uint8Array {
  return new Uint8Array(size);
}

describe('SNES ROM header detection', () => {
  it('detects LoROM mapping with valid checksum/complement', () => {
    const rom = mkRom(0x8000);
    const base = 0x7fc0;
    // Title 'TEST'
    rom.set([0x54,0x45,0x53,0x54], base);
    // Complement and checksum such that complement ^ checksum == 0xFFFF
    rom[base + 0x1c] = 0x34; rom[base + 0x1d] = 0x12; // complement = 0x1234
    rom[base + 0x1e] = 0xcb; rom[base + 0x1f] = 0xed; // checksum = 0xedcb, xor -> 0xffff

    expect(detectMapping(rom)).toBe('lorom');
    const h = parseHeader(rom);
    expect(h.mapping).toBe('lorom');
    expect(h.title.startsWith('TEST')).toBe(true);
    expect(((h.complement ^ h.checksum) & 0xffff) === 0xffff).toBe(true);
  });

  it('prefers HiROM if only HiROM header is valid', () => {
    const rom = mkRom(0x20000);
    const baseHi = 0xffc0;
    rom[baseHi + 0x1c] = 0x78; rom[baseHi + 0x1d] = 0x56;
    rom[baseHi + 0x1e] = 0x87; rom[baseHi + 0x1f] = 0xa9; // 0x5678 ^ 0xa987 = 0xffff

    expect(detectMapping(rom)).toBe('hirom');
  });
});
