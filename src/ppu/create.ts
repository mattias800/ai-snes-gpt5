import { PPU } from './ppu';
import { TimingPPU } from './timing/ppu_timing';
import type { IPPU } from './ipu';

export const createPPU = (mode: 'simple' | 'timing' = 'simple'): IPPU => {
  return mode === 'timing' ? new TimingPPU() : (new PPU() as unknown as IPPU);
};

