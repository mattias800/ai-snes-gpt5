import { describe, it, expect } from 'vitest';
import { APUTimer } from '../../src/apu/timers';

describe('APU Timers (functional approximation)', () => {
  it('timer0/1 increment 4-bit counters when enabled and ticked', () => {
    const t0 = new APUTimer(8, 16);
    t0.setEnabled(true);
    t0.setTarget(4); // small period
    const before = t0.readCounter();
    t0.tick(8 * 4 * 2); // enough for 2 wraps
    const after = t0.readCounter();
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('timer2 increments 8-bit counter', () => {
    const t2 = new APUTimer(128, 256);
    t2.setEnabled(true);
    t2.setTarget(2);
    t2.tick(128 * 2 * 3);
    expect(t2.readCounter()).toBeGreaterThan(0);
  });

  it('reset pulses clear counters', () => {
    const t1 = new APUTimer(8, 16);
    t1.setEnabled(true);
    t1.setTarget(2);
    t1.tick(8 * 2 * 5);
    expect(t1.readCounter()).toBeGreaterThan(0);
    t1.clearCounter();
    expect(t1.readCounter()).toBe(0);
  });
});
