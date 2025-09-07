export class MasterClock {
  constructor(private stepCycles: (cycles: number) => void) {}

  // Run a frame by advancing one scanline at a time.
  // This helps exercise HBlank/VBlank transitions and endScanline hooks per scanline.
  runFrame(cyclesPerScanline = 1364, scanlines = 262): void {
    const cps = cyclesPerScanline | 0;
    const sls = scanlines | 0;
    if (cps <= 0 || sls <= 0) return;
    for (let sl = 0; sl < sls; sl++) this.stepCycles(cps);
  }
}

