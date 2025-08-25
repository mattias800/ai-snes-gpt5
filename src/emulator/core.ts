import { CPU65C816 } from '../cpu/cpu65c816';
import { SNESBus } from '../bus/snesBus';
import { Cartridge } from '../cart/cartridge';

export class Emulator {
  constructor(public readonly bus: SNESBus, public readonly cpu: CPU65C816) {}
  static fromCartridge(cart: Cartridge): Emulator {
    const bus = new SNESBus(cart);
    const cpu = new CPU65C816(bus);
    return new Emulator(bus, cpu);
  }
  reset(): void {
    this.cpu.reset();
  }
  stepInstruction(): void {
    this.cpu.stepInstruction();
  }
}

