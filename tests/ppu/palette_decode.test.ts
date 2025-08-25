import { describe, it, expect } from 'vitest';
import { decodeSNESColorToRGBA } from '../../src/ppu/palette';

describe('Palette: SNES BGR555 to RGBA', () => {
  it('decodes primary colors correctly', () => {
    // Red max (R=31)
    const red = decodeSNESColorToRGBA(31 << 10);
    expect(red.r).toBe(255);
    expect(red.g).toBe(0);
    expect(red.b).toBe(0);

    // Green max (G=31)
    const green = decodeSNESColorToRGBA(31 << 5);
    expect(green.r).toBe(0);
    expect(green.g).toBe(255);
    expect(green.b).toBe(0);

    // Blue max (B=31)
    const blue = decodeSNESColorToRGBA(31);
    expect(blue.r).toBe(0);
    expect(blue.g).toBe(0);
    expect(blue.b).toBe(255);
  });
});

