// FNV-1a 32-bit hash for byte buffers (deterministic, simple)
export function fnv1a32(bytes: ArrayLike<number>): number {
  let hash = 0x811c9dc5 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i] & 0xff;
    hash = Math.imul(hash >>> 0, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function fnv1aHex(bytes: ArrayLike<number>): string {
  const h = fnv1a32(bytes);
  return ('00000000' + h.toString(16)).slice(-8);
}
