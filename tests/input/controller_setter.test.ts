import { describe, it, expect } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';

function mkBus(): SNESBus {
  const rom = new Uint8Array(0x20000);
  const cart = new Cartridge({ rom, mapping: 'lorom' });
  return new SNESBus(cart);
}

describe('SNESBus.setController1State', () => {
  it('latches Start pressed and shifts out correct bit at position 3', () => {
    const bus = mkBus();

    // Set Start pressed deterministically
    bus.setController1State({ Start: true });

    // Read 12 bits from $4016; Start is 4th in sequence (index 3)
    const bits: number[] = [];
    for (let i = 0; i < 12; i++) bits.push(bus.read8(0x00004016) & 1);

    // Expect B=0, Y=0, Select=0, Start=1, others default 0
    expect(bits[0]).toBe(0);
    expect(bits[1]).toBe(0);
    expect(bits[2]).toBe(0);
    expect(bits[3]).toBe(1);
    for (let i = 4; i < 12; i++) expect(bits[i]).toBe(0);
  });
});

