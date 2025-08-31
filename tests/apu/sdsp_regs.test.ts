import { describe, it, expect } from 'vitest';
import { SDSP } from '../../src/apu/sdsp';

describe('SDSP register window ($F2/$F3)', () => {
  it('reads back written values at selected addresses', () => {
    const dsp = new SDSP();
    dsp.reset();

    // Write a few addresses
    dsp.writeAddr(0x2a); dsp.writeData(0x55);
    dsp.writeAddr(0x2b); dsp.writeData(0xaa);
    dsp.writeAddr(0x2c); dsp.writeData(0x11);

    // Read back
    dsp.writeAddr(0x2a); expect(dsp.readData()).toBe(0x55);
    dsp.writeAddr(0x2b); expect(dsp.readData()).toBe(0xaa);
    dsp.writeAddr(0x2c); expect(dsp.readData()).toBe(0x11);
  });
});
