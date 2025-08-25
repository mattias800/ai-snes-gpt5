export type Mapping = 'lorom' | 'hirom';

function readLE16(rom: Uint8Array, off: number): number {
  return (rom[off] | (rom[off + 1] << 8)) & 0xffff;
}

export function detectMapping(rom: Uint8Array): Mapping {
  const loOff = 0x7fc0;
  const hiOff = 0xffc0;
  const score = (off: number): number => {
    if (rom.length < off + 0x50) return 0;
    const complement = readLE16(rom, off + 0x1c);
    const checksum = readLE16(rom, off + 0x1e);
    if (((complement ^ checksum) & 0xffff) === 0xffff) return 2;
    return 0;
  };
  const loScore = score(loOff);
  const hiScore = score(hiOff);
  if (hiScore > loScore) return 'hirom';
  return 'lorom';
}

export interface ParsedHeader {
  mapping: Mapping;
  checksum: number;
  complement: number;
  title: string;
}

export function parseHeader(rom: Uint8Array): ParsedHeader {
  const mapping = detectMapping(rom);
  const base = mapping === 'lorom' ? 0x7fc0 : 0xffc0;
  const titleBytes = rom.slice(base, base + 21);
  const title = new TextDecoder('ascii', { fatal: false }).decode(titleBytes).replace(/\u0000/g, '').trim();
  const complement = readLE16(rom, base + 0x1c);
  const checksum = readLE16(rom, base + 0x1e);
  return { mapping, checksum, complement, title };
}
