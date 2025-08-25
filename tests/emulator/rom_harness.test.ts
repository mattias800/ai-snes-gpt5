import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { normaliseRom } from '../../src/cart/loader';
import { parseHeader } from '../../src/cart/header';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';

const VEC_LO = 0x00fffc;
const VEC_HI = 0x00fffd;

function vecFromBus(bus: SNESBus): number {
  const lo = bus.read8(VEC_LO);
  const hi = bus.read8(VEC_HI);
  return ((hi << 8) | lo) & 0xffff;
}

describe('ROM harness (env-gated)', () => {
  const romPath = process.env.SNES_ROM;
  if (!romPath) {
    it.skip('SNES_ROM not set; skipping ROM harness', () => {});
    return;
  }

  it('loads ROM, detects mapping, and reset vector matches expected ROM offset', () => {
    const raw = fs.readFileSync(romPath);
    const { rom } = normaliseRom(new Uint8Array(raw));
    const header = parseHeader(rom);
    const cart = new Cartridge({ rom, mapping: header.mapping });
    const bus = new SNESBus(cart);

    const vec = vecFromBus(bus);
    // Compute expected reset vector from ROM bytes depending on mapping
    const offset = header.mapping === 'lorom' ? 0x7ffc : 0xfffc;
    const lo = rom[offset];
    const hi = rom[offset + 1];
    const expected = ((hi << 8) | lo) & 0xffff;
    expect(vec).toBe(expected);
  });
});

