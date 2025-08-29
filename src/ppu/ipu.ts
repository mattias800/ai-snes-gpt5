export interface IPPU {
  // MMIO — $2100-$213F: low byte of $21xx address
  readReg: (addr: number) => number;
  writeReg: (addr: number, value: number) => void;

  // Timing
  reset: () => void;
  stepDot: () => void;
  stepScanline: () => void;

  // Counters and status
  getHCounter: () => number; // horizontal dot within scanline
  getVCounter: () => number; // scanline index
  isHBlank: () => boolean;
  isVBlank: () => boolean;

  // Optional: return current pixel (BGR555 packed) or RGBA mapping hook for headless rendering
  getPixelRGB15?: () => number;
  getPixelRGBA?: () => number; // 0xAABBGGRR (optional format for debug)

  // Optional trace utilities
  enableTrace?: (opts: { scanlineStart?: number; scanlineEnd?: number; dotStart?: number; dotEnd?: number }) => void;
  disableTrace?: () => void;
}

