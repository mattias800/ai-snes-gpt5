import { describe, it, expect } from 'vitest';
import { fnv1aHex } from '../../src/utils/hash';

describe('fnv1a', () => {
  it('hashes known sequences', () => {
    expect(fnv1aHex(new Uint8Array([]))).toBe('811c9dc5');
    expect(fnv1aHex(new Uint8Array([0x61]))).toBe('e40c292c'); // 'a'
    expect(fnv1aHex(new Uint8Array([0x61, 0x62, 0x63]))).toBe('1a47e90b'); // 'abc' per our fnv1a32 impl
  });
});

