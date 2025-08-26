import { describe, it, expect } from 'vitest';
import { stripSnesHeader, normaliseRom } from '../../src/cart/loader';
function bytes(n) { return new Uint8Array(n); }
describe('ROM loader', () => {
    it('strips 512-byte copier header when present', () => {
        const raw = bytes(1024 + 512);
        raw[511] = 0xaa; // last of header
        raw[512] = 0xbb; // first of ROM
        const s = stripSnesHeader(raw);
        expect(s.length).toBe(1024);
        expect(s[0]).toBe(0xbb);
    });
    it('normalises and leaves proper ROM untouched', () => {
        const raw = bytes(0x8000);
        const { rom } = normaliseRom(raw);
        expect(rom.length).toBe(raw.length);
    });
});
