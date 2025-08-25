import { IMemoryBus, Byte, Word } from '../emulator/types';

export interface CPUState {
  A: Word; // Accumulator (can be 8 or 16 bits depending on M)
  X: Word; // Index X (8 or 16 depending on X flag)
  Y: Word; // Index Y
  D: Word; // Direct page register
  DBR: Byte; // Data bank register
  PBR: Byte; // Program bank register
  S: Word; // Stack pointer
  PC: Word; // Program counter (within bank)
  P: Byte; // Status flags NVmxdizc (N V m x d i z c; m/x only in native)
  E: boolean; // Emulation mode flag (E=1 => emulation)
}

export const enum Flag {
  C = 0x01,
  Z = 0x02,
  I = 0x04,
  D = 0x08,
  X = 0x10,
  M = 0x20,
  V = 0x40,
  N = 0x80,
}

export class CPU65C816 {
  constructor(private bus: IMemoryBus) {}

  state: CPUState = {
    A: 0,
    X: 0,
    Y: 0,
    D: 0,
    DBR: 0,
    PBR: 0,
    S: 0,
    PC: 0,
    P: 0,
    E: true,
  };

  reset(): void {
    // Emulation mode after reset on SNES CPU
    this.state.E = true;
    // In emulation mode, M and X are forced set (8-bit A,X,Y)
    this.state.P = (this.state.P | Flag.M | Flag.X) & ~Flag.D; // Decimal off
    // Stack pointer high byte fixed to 0x01 in emulation; low byte undefined -> typically 0xFF
    this.state.S = 0x01ff;
    // Fetch reset vector from bank 0x00 at 0xFFFC/0xFFFD
    const lo = this.bus.read8(0x00fffffc & 0xffffff);
    const hi = this.bus.read8(0x00fffffd & 0xffffff);
    this.state.PC = (hi << 8) | lo;
    this.state.PBR = 0x00;
  }

  private read8(bank: Byte, addr: Word): Byte {
    const a = ((bank << 16) | addr) >>> 0;
    return this.bus.read8(a);
  }

  private read16(bank: Byte, addr: Word): Word {
    const lo = this.read8(bank, addr);
    const hi = this.read8(bank, (addr + 1) & 0xffff);
    return (hi << 8) | lo;
  }

  stepInstruction(): void {
    // Minimal skeleton that reads opcode and does nothing (for now)
    const opcode = this.read8(this.state.PBR, this.state.PC);
    this.state.PC = (this.state.PC + 1) & 0xffff;
    switch (opcode) {
      // NOP (in 65C816, 0xEA)
      case 0xea:
        // no-op
        break;
      default:
        throw new Error(`Unimplemented opcode: ${opcode.toString(16)}`);
    }
  }
}

