// NTSC timing constants (scaffold — numeric values to be validated against timing ROMs)
export interface NtscTiming {
  readonly dotsPerLine: number;
  readonly linesPerFrame: number;
  readonly vblankStartLine: number;
  readonly vblankEndLine: number; // first visible line after VBlank
  readonly visibleDotStart: number;
  readonly visibleDotEnd: number; // exclusive
  readonly hblankStartDot: number; // approximate; refine later
  readonly hblankEndDot: number;   // dot where next line begins visible
}

export const NTSC: NtscTiming = {
  dotsPerLine: 341,          // placeholder
  linesPerFrame: 262,
  vblankStartLine: 224,
  vblankEndLine: 0,          // wraps to 0 at frame start
  visibleDotStart: 0,        // will refine once we model borders
  visibleDotEnd: 256,        // typical 256-wide visible region (tests often use 256)
  hblankStartDot: Math.floor(341 * 7 / 8), // coarse placeholder
  hblankEndDot: 0,
};

