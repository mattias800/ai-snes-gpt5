import { detectMapping } from './header';

export function stripSnesHeader(rom: Uint8Array): Uint8Array {
  // Many dumps include a 512-byte copier header; if size % 1024 == 512, strip it
  if ((rom.length % 1024) === 512) {
    return rom.slice(512);
  }
  return rom;
}

export function normaliseRom(raw: Uint8Array): { rom: Uint8Array } {
  const rom = stripSnesHeader(raw);
  // We could perform other normalisations here; for now just return
  // Accessing detectMapping ensures no throw
  detectMapping(rom);
  return { rom };
}
