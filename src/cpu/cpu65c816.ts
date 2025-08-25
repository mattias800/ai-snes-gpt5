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

  private write8(bank: Byte, addr: Word, value: Byte): void {
    const a = ((bank << 16) | addr) >>> 0;
    this.bus.write8(a, value & 0xff);
  }

  private push8(v: Byte): void {
    // Emulation mode: stack page is 0x0100, S low byte decremented
    const spAddr = (0x0100 | (this.state.S & 0xff)) & 0xffff;
    this.write8(0x00, spAddr as Word, v);
    this.state.S = ((this.state.S - 1) & 0xff) | 0x0100;
  }

  private pull8(): Byte {
    this.state.S = ((this.state.S + 1) & 0xff) | 0x0100;
    const spAddr = (0x0100 | (this.state.S & 0xff)) & 0xffff;
    return this.read8(0x00, spAddr as Word);
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

  private updateWidthConstraintsForE(): void {
    if (this.state.E) {
      // In emulation, M and X forced to 1 (8-bit)
      this.state.P |= (Flag.M | Flag.X);
      // High byte of S forced to 0x01
      this.state.S = (this.state.S & 0xff) | 0x0100;
    }
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

      // LDX #imm
      case 0xa2: {
        if (this.x8) {
          const imm = this.fetch8();
          this.state.X = (this.state.X & 0xff00) | imm;
          this.setZNFromValue(imm, 8);
        } else {
          const imm = this.fetch16();
          this.state.X = imm;
          this.setZNFromValue(imm, 16);
        }
        break;
      }

      // LDY #imm
      case 0xa0: {
        if (this.x8) {
          const imm = this.fetch8();
          this.state.Y = (this.state.Y & 0xff00) | imm;
          this.setZNFromValue(imm, 8);
        } else {
          const imm = this.fetch16();
          this.state.Y = imm;
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

      // REP / SEP (clear/set bits in P)
      case 0xc2: { // REP #imm8
        const m = this.fetch8();
        this.state.P &= ~m;
        this.updateWidthConstraintsForE();
        break;
      }
      case 0xe2: { // SEP #imm8
        const m = this.fetch8();
        this.state.P |= m;
        this.updateWidthConstraintsForE();
        break;
      }

      // XCE (exchange carry and emulation)
      case 0xfb: {
        const oldC = (this.state.P & Flag.C) !== 0 ? 1 : 0;
        const oldE = this.state.E ? 1 : 0;
        // Swap
        if (oldE) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
        this.state.E = oldC !== 0;
        this.updateWidthConstraintsForE();
        break;
      }

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

      // LDA abs (DBR:addr)
      case 0xad: {
        const addr = this.fetch16();
        const value = this.read8(this.state.DBR, addr);
        this.state.A = (this.state.A & 0xff00) | value;
        this.setZNFromValue(value, 8);
        break;
      }

      // STA abs (DBR:addr)
      case 0x8d: {
        const addr = this.fetch16();
        const value = this.state.A & 0xff; // E-mode (8-bit)
        this.write8(this.state.DBR, addr, value);
        break;
      }

      // Stack operations: PHA/PLA, PHP/PLP
      case 0x48: { // PHA
        const val = this.m8 ? (this.state.A & 0xff) : (this.state.A & 0xff);
        this.push8(val);
        break;
      }
      case 0x68: { // PLA
        const v = this.pull8();
        if (this.m8) {
          this.state.A = (this.state.A & 0xff00) | v;
          this.setZNFromValue(v, 8);
        } else {
          // In native 16-bit A mode, PLA pulls 16 bits; but in E-mode it's 8-bit
          this.state.A = (this.state.A & 0xff00) | v;
          this.setZNFromValue(v, 8);
        }
        break;
      }
      case 0x08: { // PHP
        this.push8(this.state.P);
        break;
      }
      case 0x28: { // PLP
        this.state.P = this.pull8();
        break;
      }

      // JSR abs / RTS
      case 0x20: { // JSR absolute to current bank
        const target = this.fetch16();
        // Push (PC-1) high then low
        const ret = (this.state.PC - 1) & 0xffff;
        this.push8((ret >>> 8) & 0xff);
        this.push8(ret & 0xff);
        this.state.PC = target;
        break;
      }
      case 0x60: { // RTS
        const lo = this.pull8();
        const hi = this.pull8();
        const addr = ((hi << 8) | lo) & 0xffff;
        this.state.PC = (addr + 1) & 0xffff;
        break;
      }

      default:
        throw new Error(`Unimplemented opcode: ${opcode.toString(16)}`);
    }
  }
}

