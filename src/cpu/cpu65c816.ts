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

  private get m8(): boolean {
    return (this.state.P & Flag.M) !== 0 || this.state.E; // E forces 8-bit A
  }
  private get x8(): boolean {
    return (this.state.P & Flag.X) !== 0 || this.state.E; // E forces 8-bit X/Y
  }

  reset(): void {
    // Emulation mode after reset on SNES CPU
    this.state.E = true;
    // In emulation mode, M and X are forced set (8-bit A,X,Y)
    this.state.P = (this.state.P | Flag.M | Flag.X) & ~Flag.D; // Decimal off
    // Stack pointer high byte fixed to 0x01 in emulation; low byte undefined -> typically 0xFF
    this.state.S = 0x01ff;
    // Fetch reset vector from bank 0x00 at 0xFFFC/0xFFFD
    const lo = this.read8(0x00, 0xfffc);
    const hi = this.read8(0x00, 0xfffd);
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

  private fetch8(): Byte {
    const v = this.read8(this.state.PBR, this.state.PC);
    this.state.PC = (this.state.PC + 1) & 0xffff;
    return v;
  }

  private fetch16(): Word {
    const lo = this.fetch8();
    const hi = this.fetch8();
    return (hi << 8) | lo;
  }

  private setZNFromValue(value: number, bits: 8 | 16): void {
    const mask = bits === 8 ? 0xff : 0xffff;
    const sign = bits === 8 ? 0x80 : 0x8000;
    const v = value & mask;
    if (v === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
    if ((v & sign) !== 0) this.state.P |= Flag.N; else this.state.P &= ~Flag.N;
  }

  private adc(value: number): void {
    // Decimal mode off assumed for now
    const mask = this.m8 ? 0xff : 0xffff;
    const sign = this.m8 ? 0x80 : 0x8000;
    const a = this.state.A & mask;
    const b = value & mask;
    const c = (this.state.P & Flag.C) ? 1 : 0;
    const r = a + b + c;
    // Carry
    if (r > mask) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
    // Overflow: (~(a^b) & (a^r) & sign) != 0
    const vflag = (~(a ^ b) & (a ^ r) & sign) !== 0;
    if (vflag) this.state.P |= Flag.V; else this.state.P &= ~Flag.V;
    const res = r & mask;
    this.state.A = (this.state.A & ~mask) | res;
    this.setZNFromValue(res, this.m8 ? 8 : 16);
  }

  stepInstruction(): void {
    const opcode = this.fetch8();
    switch (opcode) {
      // NOP (in 65C816, 0xEA)
      case 0xea:
        // no-op
        break;

      // LDA #imm (depends on M; in E-mode M=1 -> 8-bit)
      case 0xa9: {
        if (this.m8) {
          const imm = this.fetch8();
          this.state.A = (this.state.A & 0xff00) | imm;
          this.setZNFromValue(imm, 8);
        } else {
          const imm = this.fetch16();
          this.state.A = imm;
          this.setZNFromValue(imm, 16);
        }
        break;
      }

      // ADC #imm (decimal off)
      case 0x69: {
        if (this.m8) {
          const imm = this.fetch8();
          this.adc(imm);
        } else {
          const imm = this.fetch16();
          this.adc(imm);
        }
        break;
      }

      // CLC / SEC (clear/set carry)
      case 0x18: // CLC
        this.state.P &= ~Flag.C;
        break;
      case 0x38: // SEC
        this.state.P |= Flag.C;
        break;

      // BEQ rel8 / BNE rel8
      case 0xf0: { // BEQ
        const off = this.fetch8() << 24 >> 24; // sign-extend
        if ((this.state.P & Flag.Z) !== 0) {
          this.state.PC = (this.state.PC + off) & 0xffff;
        }
        break;
      }
      case 0xd0: { // BNE
        const off = this.fetch8() << 24 >> 24;
        if ((this.state.P & Flag.Z) === 0) {
          this.state.PC = (this.state.PC + off) & 0xffff;
        }
        break;
      }

      default:
        throw new Error(`Unimplemented opcode: ${opcode.toString(16)}`);
    }
  }
}

