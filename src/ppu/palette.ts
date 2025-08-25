// SNES CGRAM 15-bit color (BGR555), little-endian: bits 0-4=B, 5-9=G, 10-14=R
export function decodeSNESColorToRGBA(bgr15: number): { r: number; g: number; b: number; a: number } {
  const b = (bgr15 & 0x1f);
  const g = (bgr15 >> 5) & 0x1f;
  const r = (bgr15 >> 10) & 0x1f;
  const scale = (v: number) => Math.floor((v * 255) / 31);
  return { r: scale(r), g: scale(g), b: scale(b), a: 255 };
}

