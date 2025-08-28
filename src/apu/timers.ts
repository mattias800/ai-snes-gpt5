// Minimal S-SMP timer models (functional, not cycle-accurate)
// Timers 0/1 are 4-bit counters, Timer 2 is 8-bit.
// We approximate prescalers and counting behavior sufficiently for unit tests.

export class APUTimer {
  private target = 0;
  private counter = 0; // observed via $FD/$FE/$FF depending on timer
  private enabled = false;
  private prescaleAcc = 0; // accumulates APU cycles
  private phase = 0; // counts up to target then bumps counter
  private readonly div: number; // prescaler divisor (e.g., 8 for t0/t1, 128 for t2)
  private readonly width: number; // 16 for t0/t1; 256 for t2

  constructor(divisor: number, counterWidth: number) {
    this.div = Math.max(1, divisor | 0);
    this.width = Math.max(1, counterWidth | 0);
  }

  reset(): void {
    this.target = 0;
    this.counter = 0;
    this.enabled = false;
    this.prescaleAcc = 0;
    this.phase = 0;
  }

  setEnabled(on: boolean): void { this.enabled = !!on; }

  setTarget(v: number): void {
    this.target = v & 0xff;
    // Do not reset phase automatically; hardware latches target independently.
  }

  getTarget(): number { return this.target & 0xff; }

  readCounter(): number { return this.counter & 0xff; }

  clearCounter(): void { this.counter = 0; }

  // Advance by a number of APU cycles (approximate)
  tick(cycles: number): number {
    if (!this.enabled) return 0;
    let c = cycles | 0;
    if (c <= 0) return 0;
    let increments = 0;
    this.prescaleAcc += c;
    while (this.prescaleAcc >= this.div) {
      this.prescaleAcc -= this.div;
      // Increment internal phase, wrap based on target (0 interpreted as 256)
      const period = (this.target & 0xff) || 256;
      this.phase = (this.phase + 1) % period;
      if (this.phase === 0) {
        // On wrap, increment visible counter with its width
        this.counter = (this.counter + 1) % this.width;
        increments++;
      }
    }
    return increments;
  }
}
