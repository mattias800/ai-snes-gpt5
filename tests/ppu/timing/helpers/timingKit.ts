import { TimingPPU } from '../../../../src/ppu/timing/ppu_timing';
import { TimingScheduler } from '../../../../src/emulator/scheduler_timing';

export interface TimingEnv {
  ppu: TimingPPU;
  sched: TimingScheduler;
}

export const makeTimingEnv = (): TimingEnv => {
  const ppu = new TimingPPU();
  ppu.reset();
  const sched = new TimingScheduler(ppu);
  return { ppu, sched };
};

export const stepTo = (env: TimingEnv, scanline: number, dot: number): void => {
  // Step full scanlines
  const curSL = env.ppu.getVCounter();
  for (let sl = curSL; sl < scanline; sl++) env.sched.stepScanline();
  // Now on target scanline; advance dots
  while (env.ppu.getHCounter() !== dot) env.sched.stepDot();
};

