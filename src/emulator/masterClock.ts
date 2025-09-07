export class MasterClock {
  constructor(private stepCycles: (cycles: number) => void) {}

  // Run a frame at approximate dot timing using bus.tickCycles from the caller.
  // This is a scaffold behind a feature flag; it delegates cycle advancement to the bus.
  runFrame(cyclesPerScanline = 1364, scanlines = 262): void {
    const total = (cyclesPerScanline | 0) * (scanlines | 0);
    if (total <= 0) return;
    this.stepCycles(total);
  }
}

