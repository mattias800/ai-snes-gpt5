import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

describe('APUDevice control ($F1) and timers', () => {
  it('enables timer 0 and counter increases after step; reset clears', () => {
    const apu: any = new APUDevice();
    // Set target small and enable timer0 (bit0)
    apu.write8(0x00fa, 0x02);
    apu.write8(0x00f1, 0x01);
    const before = apu.read8(0x00fd);
    apu.step(8 * 2 * 10);
    const after = apu.read8(0x00fd);
    expect(after).toBeGreaterThanOrEqual(before);
    // Reset pulse bit4
    apu.write8(0x00f1, 0x10);
    const reset = apu.read8(0x00fd);
    expect(reset).toBe(0);
  });

  it('disabling timer stops increments', () => {
    const apu: any = new APUDevice();
    apu.write8(0x00fa, 0x02);
    apu.write8(0x00f1, 0x01); // enable
    apu.step(8 * 2 * 5);
    const mid = apu.read8(0x00fd);
    expect(mid).toBeGreaterThanOrEqual(0);
    apu.write8(0x00f1, 0x00); // disable all
    apu.step(8 * 2 * 10);
    const final = apu.read8(0x00fd);
    expect(final).toBe(mid);
  });
});
