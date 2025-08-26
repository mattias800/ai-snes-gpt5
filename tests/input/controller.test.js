import { describe, it, expect } from 'vitest';
import { Controller } from '../../src/input/controller';
describe('Controller shift register behavior', () => {
    it('shifts out button states in correct order', () => {
        const c = new Controller();
        c.setButton('B', true);
        c.setButton('A', true);
        // Strobe high then low to latch and start from beginning
        c.writeStrobe(1);
        c.writeStrobe(0);
        // Order: B,Y,Select,Start,Up,Down,Left,Right,A,X,L,R
        const bits = [];
        for (let i = 0; i < 12; i++)
            bits.push(c.readBit());
        // Expect B=1, A=1 at position 8; others 0
        expect(bits[0]).toBe(1);
        expect(bits[8]).toBe(1);
        for (let i = 1; i < 12; i++) {
            if (i === 8)
                continue;
            expect(bits[i]).toBe(0);
        }
    });
});
