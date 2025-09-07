import { CPU65C816 } from '../cpu/cpu65c816';
import { SNESBus } from '../bus/snesBus';
import { Cartridge } from '../cart/cartridge';

export class Emulator {
  constructor(public readonly bus: SNESBus, public readonly cpu: CPU65C816) {}
  static fromCartridge(cart: Cartridge): Emulator {
    const bus = new SNESBus(cart);
    const cpu = new CPU65C816(bus);
    const emu = new Emulator(bus, cpu);
    // Optionally auto-deliver NMI to CPU at VBlank start in synthetic timing modes.
    try {
      // @ts-ignore
      const env = (globalThis as any).process?.env ?? {};
      const auto = (env.SNES_TIMING_AUTO_NMI ?? '1').toString().toLowerCase();
      const enableAuto = auto === '1' || auto === 'true';
      if (enableAuto && typeof (bus as any).setVBlankCallback === 'function') {
        (bus as any).setVBlankCallback(() => {
          try {
            if (typeof (bus as any).pulseNMI === 'function') (bus as any).pulseNMI();
            if (typeof (bus as any).isNMIEnabled === 'function' && (bus as any).isNMIEnabled()) {
              if (typeof (cpu as any).nmi === 'function') (cpu as any).nmi();
            }
          } catch { /* noop */ }
        });
      }
    } catch { /* noop */ }
    return emu;
  }
  reset(): void {
    this.cpu.reset();
  }
  stepInstruction(): void {
    this.cpu.stepInstruction();
  }
}

