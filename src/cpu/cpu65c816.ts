import { IMemoryBus, Byte, Word } from '../emulator/types';

// Types used exclusively for optional debug/trace plumbing via globalThis
interface TraceLastPC { PBR: number; PC: number; }
interface TraceLastA { A8: number; A16: number; }
interface TraceInstr { PBR: number; PC: number; OP: number; A8: number; A16: number; }
type GlobalWithTrace = { __lastPC?: TraceLastPC; __lastA?: TraceLastA; __lastIR?: TraceInstr[] };

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

  private get debugEnabled(): boolean {
    try {
      // @ts-ignore
      return typeof process !== 'undefined' && process?.env?.CPU_DEBUG === '1';
    } catch {
      return false;
    }
  }
  private dbg(...args: any[]): void { if (this.debugEnabled) { try { console.log(...args); } catch { /* noop */ } } }

  // CPU low-power states
  private waitingForInterrupt = false;
  private stopped = false;

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
  private indexX(): number { return this.x8 ? (this.state.X & 0xff) : (this.state.X & 0xffff); }
  private indexY(): number { return this.x8 ? (this.state.Y & 0xff) : (this.state.Y & 0xffff); }

  reset(): void {
    // Clear low-power states
    this.waitingForInterrupt = false;
    this.stopped = false;
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
    // 16-bit data read within the same bank. Do NOT carry into the bank when crossing $FFFF.
    // Matches 65C816 absolute/direct-page semantics (DBR fixed for operand fetches).
    const lo = this.read8(bank, addr);
    const hi = this.read8(bank, (addr + 1) & 0xffff);
    return ((hi << 8) | lo) & 0xffff;
  }

  // Read a 16-bit value allowing 24-bit carry across $FFFF -> next bank for the high byte.
  private read16Cross(bank: Byte, addr: Word): Word {
    // 16-bit data read with 24-bit carry for long addressing (bank:addr + 1 may step into next bank)
    const lo = this.read8(bank, addr);
    const nextAddr = (addr + 1) & 0xffff;
    const nextBank = nextAddr === 0x0000 ? ((bank + 1) & 0xff) : bank;
    const hi = this.read8(nextBank, nextAddr);
    return ((hi << 8) | lo) & 0xffff;
  }

  // Add index to base as a 24-bit address (bank:base), allowing carry into the bank.
  // This matches 65C816 behavior for absolute indexed (DBR:abs + X/Y) and (dp),Y effective addresses.
  private addIndexToAddress(bank: Byte, base: Word, index: number): { bank: Byte; addr: Word } {
    const base24 = ((bank & 0xff) << 16) | (base & 0xffff);
    const sum24 = (base24 + (index & 0xffff)) >>> 0;
    const effBank = (sum24 >>> 16) & 0xff;
    const effAddr = sum24 & 0xffff;
    return { bank: effBank as Byte, addr: effAddr as Word };
  }

  private write8(bank: Byte, addr: Word, value: Byte): void {
    const a = ((bank << 16) | addr) >>> 0;
    this.bus.write8(a, value & 0xff);
  }

  private write16Cross(bank: Byte, addr: Word, value: Word): void {
    // 16-bit data write with 24-bit carry: if addr=$FFFF, write high byte to (bank+1):$0000
    this.write8(bank, addr, value & 0xff);
    const nextAddr = (addr + 1) & 0xffff;
    const nextBank = nextAddr === 0x0000 ? ((bank + 1) & 0xff) : bank;
    this.write8(nextBank, nextAddr, (value >>> 8) & 0xff);
  }

  // 16-bit data write within the same bank. The bank does NOT change when crossing $FFFF.
  private write16(bank: Byte, addr: Word, value: Word): void {
    this.write8(bank, addr, value & 0xff);
    this.write8(bank, (addr + 1) & 0xffff, (value >>> 8) & 0xff);
  }

  // Direct Page indexed addressing effective address
  private effDPIndexed(dp: number, useX: boolean): Word {
    const D = this.state.D & 0xffff;
    const idxFull = useX ? this.indexX() : this.indexY();
    // When X/Y are 8-bit (E=1 or X flag set), dp+index wraps within 8-bit before adding D.
    // When X/Y are 16-bit (native X flag clear), use full 16-bit dp+index.
    const effOffset = (this.x8
      ? (((dp & 0xff) + (idxFull & 0xff)) & 0xff)
      : (((dp & 0xff) + idxFull) & 0xffff));
    return (D + effOffset) & 0xffff;
  }

  // Helpers for direct page and stack-relative pointer fetches with correct wrap semantics
  private dpAddr(off8: number): Word {
    return (this.state.D + (off8 & 0xff)) & 0xffff;
  }
  private dpPtr16(off8: number): Word {
    // For (dp) style 16-bit pointers, the 65C816 keeps the classic 6502 zero-page wrap behavior
    // between the low and high pointer bytes: high byte comes from D + ((dp + 1) & 0xff).
    // This differs from [dp] long, which fetches bytes linearly (no 8-bit wrap).
    const D = this.state.D & 0xffff;
    const loAddr = (D + (off8 & 0xff)) & 0xffff;
    const hiAddr = (D + ((off8 + 1) & 0xff)) & 0xffff; // 8-bit wrap within direct page
    const lo = this.read8(0x00, loAddr);
    const hi = this.read8(0x00, hiAddr);
    const ptr = ((hi << 8) | lo) & 0xffff;
    if (this.debugEnabled) {
      this.dbg(`[dpPtr16] D=$${D.toString(16).padStart(4,'0')} off=$${(off8 & 0xff).toString(16).padStart(2,'0')} loAddr=$${loAddr.toString(16).padStart(4,'0')} hiAddr=$${hiAddr.toString(16).padStart(4,'0')} lo=$${lo.toString(16).padStart(2,'0')} hi=$${hi.toString(16).padStart(2,'0')} -> ptr=$${ptr.toString(16).padStart(4,'0')}`);
    }
    return ptr;
  }
  private dpPtrLong(off8: number): { bank: Byte; addr: Word } {
    // For [dp] long pointers, bytes are fetched linearly from D+dp, D+dp+1, D+dp+2 (16-bit increment),
    // i.e., no 8-bit wrap between bytes. This matches 65C816 [dp] semantics and the snes-tests vectors.
    const base = (this.state.D + (off8 & 0xff)) & 0xffff;
    const loAddr = base;
    const hiAddr = (base + 1) & 0xffff;
    const bkAddr = (base + 2) & 0xffff;
    const lo = this.read8(0x00, loAddr);
    const hi = this.read8(0x00, hiAddr);
    const bank = this.read8(0x00, bkAddr) & 0xff;
    return { bank: bank as Byte, addr: (((hi << 8) | lo) & 0xffff) as Word };
  }
  private srBase(): Word {
    return this.state.E ? ((0x0100 | (this.state.S & 0xff)) & 0xffff) : (this.state.S & 0xffff);
  }
  private srPtr16(sr: number): Word {
    const base = this.srBase();
    const off = sr & 0xff;
    const loAddr = (base + off) & 0xffff;
    const hiAddr = (loAddr + 1) & 0xffff; // stack-relative pointer fetch increments without 8-bit wrap
    const lo = this.read8(0x00, loAddr as Word);
    const hi = this.read8(0x00, hiAddr as Word);
    return ((hi << 8) | lo) & 0xffff;
  }

  // Effective address helpers for common indirect/long modes
  private effDP(dp: number): { bank: Byte; addr: Word } {
    const D = this.state.D & 0xffff;
    const addr = (D + (dp & 0xff)) & 0xffff;
    return { bank: 0x00, addr: addr as Word };
  }

  // (dp) -> pointer in bank0 at D+dp, yielding 16-bit address in DBR bank
  private effIndDP(dp: number): { bank: Byte; addr: Word } {
    const base = this.dpPtr16(dp);
    return { bank: this.state.DBR & 0xff, addr: base as Word };
  }

  // (dp),Y -> pointer in bank0 at D+dp; effective address is DBR:base + Y with 24-bit carry into bank
  private effIndDPY(dp: number): { bank: Byte; addr: Word } {
    const base = this.dpPtr16(dp);
    const { bank, addr } = this.addIndexToAddress(this.state.DBR & 0xff, base as Word, this.indexY());
    return { bank, addr };
  }

  // [dp] -> long pointer (bank:addr) from bank0 at D+dp
  private effLongDP(dp: number): { bank: Byte; addr: Word } {
    return this.dpPtrLong(dp);
  }

  // [dp],Y -> long pointer, add Y as 24-bit with carry into bank
  private effLongDPY(dp: number): { bank: Byte; addr: Word } {
    const p = this.dpPtrLong(dp);
    const sum24 = ((p.bank & 0xff) << 16) | (p.addr & 0xffff);
    const indexed24 = (sum24 + this.indexY()) >>> 0;
    const effBank = (indexed24 >>> 16) & 0xff;
    const effAddr = indexed24 & 0xffff;
    return { bank: effBank as Byte, addr: effAddr as Word };
  }

  // (sr),Y -> pointer from stack-relative address in bank0; effective address is DBR:base + Y with 24-bit carry
  private effSRY(sr: number): { bank: Byte; addr: Word } {
    const base = this.srPtr16(sr);
    const { bank, addr } = this.addIndexToAddress(this.state.DBR & 0xff, base as Word, this.indexY());
    return { bank, addr };
  }

  private push8(v: Byte): void {
    // Stack page is 0x0100 in emulation; full 16-bit S in native. Stack always in bank 0.
    const spAddr: Word = this.state.E ? ((0x0100 | (this.state.S & 0xff)) & 0xffff) : (this.state.S & 0xffff);
    this.write8(0x00, spAddr as Word, v);
    if (this.state.E) {
      this.state.S = ((this.state.S - 1) & 0xff) | 0x0100;
    } else {
      this.state.S = (this.state.S - 1) & 0xffff;
    }
  }

  private pull8(): Byte {
    if (this.state.E) {
      this.state.S = ((this.state.S + 1) & 0xff) | 0x0100;
    } else {
      this.state.S = (this.state.S + 1) & 0xffff;
    }
    const spAddr: Word = this.state.E ? ((0x0100 | (this.state.S & 0xff)) & 0xffff) : (this.state.S & 0xffff);
    return this.read8(0x00, spAddr as Word);
  }

  private fetch8(): Byte {
    const v = this.read8(this.state.PBR, this.state.PC);
    // Increment PC and carry into PBR on wrap, matching 65C816 instruction fetch semantics
    this.state.PC = (this.state.PC + 1) & 0xffff;
    if (this.state.PC === 0x0000) {
      this.state.PBR = (this.state.PBR + 1) & 0xff;
    }
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
    // If decimal mode is set, perform BCD arithmetic
    if ((this.state.P & Flag.D) !== 0) {
      this.adcBCD(value);
      return;
    }
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

  private sbc(value: number): void {
    // If decimal mode is set, perform BCD arithmetic
    if ((this.state.P & Flag.D) !== 0) {
      this.sbcBCD(value);
      return;
    }
    const mask = this.m8 ? 0xff : 0xffff;
    const sign = this.m8 ? 0x80 : 0x8000;
    const a = this.state.A & mask;
    const b = value & mask;
    const c = (this.state.P & Flag.C) ? 1 : 0; // 1 means no borrow
    const rSigned = a - b - (1 - c);
    const res = rSigned & mask;
    // Carry set if no borrow (i.e., result >= 0 in signed arithmetic over mask)
    if (rSigned >= 0) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
    // Overflow if sign(a) != sign(b) and sign(res) != sign(a)
    const vflag = ((a ^ b) & (a ^ res) & sign) !== 0;
    if (vflag) this.state.P |= Flag.V; else this.state.P &= ~Flag.V;
    this.state.A = (this.state.A & ~mask) | res;
    this.setZNFromValue(res, this.m8 ? 8 : 16);
  }

  private aslA(): void {
    if (this.m8) {
      const a = this.state.A & 0xff;
      const c = (a & 0x80) !== 0;
      const res = (a << 1) & 0xff;
      if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
      this.state.A = (this.state.A & 0xff00) | res;
      this.setZNFromValue(res, 8);
    } else {
      const a = this.state.A & 0xffff;
      const c = (a & 0x8000) !== 0;
      const res = (a << 1) & 0xffff;
      if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
      this.state.A = res;
      this.setZNFromValue(res, 16);
    }
  }

  private lsrA(): void {
    if (this.m8) {
      const a = this.state.A & 0xff;
      const c = (a & 0x01) !== 0;
      const res = (a >>> 1) & 0xff;
      if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
      this.state.A = (this.state.A & 0xff00) | res;
      this.setZNFromValue(res, 8);
    } else {
      const a = this.state.A & 0xffff;
      const c = (a & 0x0001) !== 0;
      const res = (a >>> 1) & 0xffff;
      if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
      this.state.A = res;
      this.setZNFromValue(res, 16);
    }
  }

  private rolA(): void {
    if (this.m8) {
      const a = this.state.A & 0xff;
      const carryIn = (this.state.P & Flag.C) ? 1 : 0;
      const newC = (a & 0x80) !== 0;
      const res = ((a << 1) & 0xff) | carryIn;
      if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
      this.state.A = (this.state.A & 0xff00) | res;
      this.setZNFromValue(res, 8);
    } else {
      const a = this.state.A & 0xffff;
      const carryIn = (this.state.P & Flag.C) ? 1 : 0;
      const newC = (a & 0x8000) !== 0;
      const res = ((a << 1) & 0xffff) | carryIn;
      if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
      this.state.A = res;
      this.setZNFromValue(res, 16);
    }
  }

  private rorA(): void {
    if (this.m8) {
      const a = this.state.A & 0xff;
      const carryIn = (this.state.P & Flag.C) ? 0x80 : 0;
      const newC = (a & 0x01) !== 0;
      const res = ((a >>> 1) | carryIn) & 0xff;
      if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
      this.state.A = (this.state.A & 0xff00) | res;
      this.setZNFromValue(res, 8);
    } else {
      const a = this.state.A & 0xffff;
      const carryIn = (this.state.P & Flag.C) ? 0x8000 : 0;
      const newC = (a & 0x0001) !== 0;
      const res = ((a >>> 1) | carryIn) & 0xffff;
      if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
      this.state.A = res;
      this.setZNFromValue(res, 16);
    }
  }

  // BCD helpers for ADC/SBC when Decimal mode (Flag.D) is set
  private adcBCD(value: number): void {
    if (this.m8) {
      const a = this.state.A & 0xff;
      const b = value & 0xff;
      const c = (this.state.P & Flag.C) ? 1 : 0;
      // Binary sum for V computation
      const rbin = a + b + c;
      const vflag = (~(a ^ b) & (a ^ rbin) & 0x80) !== 0;
      if (vflag) this.state.P |= Flag.V; else this.state.P &= ~Flag.V;
      let r = rbin;
      if ((r & 0x0f) > 0x09) r += 0x06;
      let carry = 0;
      if (r > 0x99) { r += 0x60; carry = 1; }
      if (carry) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
      const res = r & 0xff;
      this.state.A = (this.state.A & 0xff00) | res;
      this.setZNFromValue(res, 8);
    } else {
      const a = this.state.A & 0xffff;
      const b = value & 0xffff;
      const c = (this.state.P & Flag.C) ? 1 : 0;
      // Binary sum for V computation
      const rbin = a + b + c;
      const vflag = (~(a ^ b) & (a ^ rbin) & 0x8000) !== 0;
      if (vflag) this.state.P |= Flag.V; else this.state.P &= ~Flag.V;
      // Low byte BCD adjust
      let lo = (a & 0xff) + (b & 0xff) + c;
      if ((lo & 0x0f) > 0x09) lo += 0x06;
      let carry1 = 0;
      if (lo > 0x99) { lo += 0x60; carry1 = 1; }
      lo &= 0xff;
      // High byte BCD adjust (include carry from low)
      let hi = ((a >>> 8) & 0xff) + ((b >>> 8) & 0xff) + carry1;
      let carry2 = 0;
      if ((hi & 0x0f) > 0x09) hi += 0x06;
      if (hi > 0x99) { hi += 0x60; carry2 = 1; }
      hi &= 0xff;
      const res = ((hi << 8) | lo) & 0xffff;
      if (carry2) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
      this.state.A = res;
      this.setZNFromValue(res, 16);
    }
  }

  private sbcBCD(value: number): void {
    if (this.m8) {
      const a = this.state.A & 0xff;
      const b = value & 0xff;
      const c = (this.state.P & Flag.C) ? 1 : 0; // 1 means no borrow
      const diff = a - b - (1 - c);
      const resBin = diff & 0xff;
      const vflag = ((a ^ b) & (a ^ resBin) & 0x80) !== 0;
      if (vflag) this.state.P |= Flag.V; else this.state.P &= ~Flag.V;
      let r = diff;
      const lowBorrow = ((a & 0x0f) - (b & 0x0f) - (1 - c)) < 0;
      if (lowBorrow) r -= 0x06;
      if (diff < 0) r -= 0x60;
      const carry = diff >= 0 ? 1 : 0;
      if (carry) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
      const res = r & 0xff;
      this.state.A = (this.state.A & 0xff00) | res;
      this.setZNFromValue(res, 8);
    } else {
      const a = this.state.A & 0xffff;
      const b = value & 0xffff;
      const c = (this.state.P & Flag.C) ? 1 : 0;
      const diffBin = a - b - (1 - c);
      const resBin = diffBin & 0xffff;
      const vflag = ((a ^ b) & (a ^ resBin) & 0x8000) !== 0;
      if (vflag) this.state.P |= Flag.V; else this.state.P &= ~Flag.V;
      // Low byte
      const al = a & 0xff;
      const bl = b & 0xff;
      let d0 = al - bl - (1 - c);
      const lowBorrow0 = ((al & 0x0f) - (bl & 0x0f) - (1 - c)) < 0;
      if (lowBorrow0) d0 -= 0x06;
      let borrow1 = 0;
      if (d0 < 0) { d0 -= 0x60; borrow1 = 1; }
      const lo = d0 & 0xff;
      // High byte
      const ah = (a >>> 8) & 0xff;
      const bh = (b >>> 8) & 0xff;
      let d1 = ah - bh - borrow1;
      const lowBorrow1 = ((ah & 0x0f) - (bh & 0x0f) - borrow1) < 0;
      if (lowBorrow1) d1 -= 0x06;
      let borrow2 = 0;
      if (d1 < 0) { d1 -= 0x60; borrow2 = 1; }
      const hi = d1 & 0xff;
      const res = ((hi << 8) | lo) & 0xffff;
      const carry = borrow2 === 0 ? 1 : 0;
      if (carry) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
      this.state.A = res;
      this.setZNFromValue(res, 16);
    }
  }

  private cmpValues(a: number, b: number, bits: 8 | 16): void {
    const mask = bits === 8 ? 0xff : 0xffff;
    const sign = bits === 8 ? 0x80 : 0x8000;
    const r = (a - b) & mask;
    // C set if a >= b (no borrow)
    if ((a & mask) >= (b & mask)) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
    // Z/N from result
    if (r === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
    if ((r & sign) !== 0) this.state.P |= Flag.N; else this.state.P &= ~Flag.N;
  }

  private updateWidthConstraintsForE(): void {
    if (this.state.E) {
      // In emulation, M and X forced to 1 (8-bit)
      this.state.P |= (Flag.M | Flag.X);
      // High byte of S forced to 0x01
      this.state.S = (this.state.S & 0xff) | 0x0100;
    }
  }

  private applyWidthAfterPChange(): void {
    // When X=1 or in emulation, X/Y are 8-bit; mask high bytes
    if (this.state.E || (this.state.P & Flag.X) !== 0) {
      this.state.X &= 0x00ff;
      this.state.Y &= 0x00ff;
    }
    // IMPORTANT: Do NOT clear the high byte of A when M=1.
    // On 65C816 the high byte (B) remains intact in 8-bit accumulator mode
    // and is observable via XBA. Clearing it each step breaks XBA and other tests.
  }

  // NMI service: push PC and P, set I; vector depends on emulation/native mode
  public nmi(): void {
    if (this.stopped) return; // STP halts CPU clock
    // Clear WAI state on interrupt
    this.waitingForInterrupt = false;
    // Push return state (emulation: PCH,PCL,P)
    const pc = this.state.PC;
    this.push8((pc >>> 8) & 0xff);
    this.push8(pc & 0xff);
    this.push8(this.state.P);
    // Set I flag and vector
    this.state.P |= Flag.I;
    // Hardware-accurate NMI vectors:
    // - Emulation mode (E=1): $FFFA/$FFFB
    // - Native mode (E=0):    $FFEA/$FFEB
    const vecLoAddr = this.state.E ? 0xfffa : 0xffea;
    const vecHiAddr = (vecLoAddr + 1) & 0xffff;
    const lo = this.read8(0x00, vecLoAddr as Word);
    const hi = this.read8(0x00, vecHiAddr as Word);
    this.state.PBR = 0x00;
    this.state.PC = ((hi << 8) | lo) & 0xffff;
  }

  // Minimal IRQ service: if I=0, push PC and P, set I, vector based on E (emulation/native), PBR=0
  public irq(): void {
    if (this.stopped) return;
    if ((this.state.P & Flag.I) !== 0) return; // masked
    // Clear WAI state on interrupt
    this.waitingForInterrupt = false;
    const pc = this.state.PC;
    this.push8((pc >>> 8) & 0xff);
    this.push8(pc & 0xff);
    this.push8(this.state.P);
    this.state.P |= Flag.I;
    const vecLoAddr = this.state.E ? 0xfffe : 0xffee;
    const vecHiAddr = (vecLoAddr + 1) & 0xffff;
    const lo = this.read8(0x00, vecLoAddr as Word);
    const hi = this.read8(0x00, vecHiAddr as Word);
    this.state.PBR = 0x00;
    this.state.PC = ((hi << 8) | lo) & 0xffff;
  }

  stepInstruction(): void {
    // If CPU is stopped, do nothing (halt)
    if (this.stopped) return;
    // If in WAI (wait for interrupt), do nothing until an interrupt occurs
    if (this.waitingForInterrupt) return;

    // Enforce emulation-mode invariants before executing an instruction.
    // On real hardware, when E=1, M and X are forced to 1 and the stack page is 0x0100.
    // Also ensure registers are masked to width if flags change.
    this.updateWidthConstraintsForE();
    this.applyWidthAfterPChange();

    // Record PC for external MMIO logs if desired
    const prevPC = this.state.PC & 0xffff;
    const prevPBR = this.state.PBR & 0xff;
    try {
      const g = (globalThis as unknown as GlobalWithTrace);
      g.__lastPC = { PBR: prevPBR, PC: prevPC };
      g.__lastA = { A8: this.state.A & 0xff, A16: this.state.A & 0xffff };
    } catch { void 0; }
    const opcode = this.fetch8();
    if (this.debugEnabled) {
      const pHex = (this.state.P & 0xff).toString(16).padStart(2, '0');
      this.dbg(`[CPU] E=${this.state.E ? 1 : 0} P=$${pHex} m8=${this.m8 ? 1 : 0} x8=${this.x8 ? 1 : 0} @ ${prevPBR.toString(16).padStart(2,'0')}:${prevPC.toString(16).padStart(4,'0')} OP=$${opcode.toString(16).padStart(2,'0')}`);
    }
    // Maintain a tiny ring buffer of recent instructions (PC/opcode) for targeted debug dumps
    try {
      const g2 = (globalThis as unknown as GlobalWithTrace);
      g2.__lastIR = g2.__lastIR || [];
      g2.__lastIR.push({ PBR: prevPBR, PC: prevPC, OP: opcode & 0xff, A8: this.state.A & 0xff, A16: this.state.A & 0xffff });
      if (g2.__lastIR.length > 64) g2.__lastIR.shift();
    } catch { void 0; }
    switch (opcode) {
      // NOP (in 65C816, 0xEA)
      case 0xea:
        // no-op
        break;

      // WDM (0x42): reserved; consume one operand byte, no effect
      case 0x42: {
        void this.fetch8();
        break;
      }

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
      // ADC memory forms
      case 0x65: { // ADC dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.m8) {
          const m = this.read8(0x00, eff);
          this.adc(m);
        } else {
          const m = this.read16(0x00, eff);
          this.adc(m);
        }
        break;
      }
      case 0x75: { // ADC dp,X
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, true);
        if (this.m8) {
          const m = this.read8(0x00, eff);
          this.dbg(`[ADC dp,X] m8=1 D=$${(this.state.D & 0xffff).toString(16).padStart(4,'0')} eff=$${eff.toString(16).padStart(4,'0')} A_pre=$${(this.state.A & 0xff).toString(16).padStart(2,'0')} m=$${m.toString(16).padStart(2,'0')}`);
          this.adc(m);
          this.dbg(`[ADC dp,X] -> A=$${(this.state.A & 0xff).toString(16).padStart(2,'0')} P=$${(this.state.P & 0xff).toString(16).padStart(2,'0')}`);
        } else {
          const m = this.read16(0x00, eff);
          this.dbg(`[ADC dp,X] m8=0 D=$${(this.state.D & 0xffff).toString(16).padStart(4,'0')} eff=$${eff.toString(16).padStart(4,'0')} A_pre=$${(this.state.A & 0xffff).toString(16).padStart(4,'0')} m16=$${m.toString(16).padStart(4,'0')}`);
          this.adc(m);
          this.dbg(`[ADC dp,X] -> A=$${(this.state.A & 0xffff).toString(16).padStart(4,'0')} P=$${(this.state.P & 0xff).toString(16).padStart(2,'0')}`);
        }
        break;
      }
      case 0x6d: { // ADC abs
        const addr = this.fetch16();
        if (this.m8) {
          const m = this.read8(this.state.DBR, addr);
          this.dbg(`[ADC abs] m8=1 DBR=$${(this.state.DBR & 0xff).toString(16).padStart(2,'0')} addr=$${addr.toString(16).padStart(4,'0')} A_pre=$${(this.state.A & 0xff).toString(16).padStart(2,'0')} m=$${m.toString(16).padStart(2,'0')}`);
          this.adc(m);
          this.dbg(`[ADC abs] -> A=$${(this.state.A & 0xff).toString(16).padStart(2,'0')} P=$${(this.state.P & 0xff).toString(16).padStart(2,'0')}`);
        } else {
          const m = this.read16(this.state.DBR, addr);
          this.dbg(`[ADC abs] m8=0 DBR=$${(this.state.DBR & 0xff).toString(16).padStart(2,'0')} addr=$${addr.toString(16).padStart(4,'0')} A_pre=$${(this.state.A & 0xffff).toString(16).padStart(4,'0')} m16=$${m.toString(16).padStart(4,'0')}`);
          this.adc(m);
          this.dbg(`[ADC abs] -> A=$${(this.state.A & 0xffff).toString(16).padStart(4,'0')} P=$${(this.state.P & 0xff).toString(16).padStart(2,'0')}`);
        }
        break;
      }
      case 0x7d: { // ADC abs,X
        const addr = this.fetch16();
        const { bank: effBank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexX());
        if (this.m8) {
          const m = this.read8(effBank, eff);
this.dbg(`[ADC abs,X] m8=1 DBR=$${(effBank & 0xff).toString(16).padStart(2,'0')} addr=$${eff.toString(16).padStart(4,'0')} A_pre=$${(this.state.A & 0xff).toString(16).padStart(2,'0')} m=$${m.toString(16).padStart(2,'0')}`);
          this.adc(m);
          this.dbg(`[ADC abs,X] -> A=$${(this.state.A & 0xff).toString(16).padStart(2,'0')} P=$${(this.state.P & 0xff).toString(16).padStart(2,'0')}`);
        } else {
          const m = this.read16(effBank, eff);
this.dbg(`[ADC abs,X] m8=0 DBR=$${(effBank & 0xff).toString(16).padStart(2,'0')} addr=$${eff.toString(16).padStart(4,'0')} A_pre=$${(this.state.A & 0xffff).toString(16).padStart(4,'0')} m16=$${m.toString(16).padStart(4,'0')}`);
          this.adc(m);
          this.dbg(`[ADC abs,X] -> A=$${(this.state.A & 0xffff).toString(16).padStart(4,'0')} P=$${(this.state.P & 0xff).toString(16).padStart(2,'0')}`);
        }
        break;
      }
      case 0x79: { // ADC abs,Y
        const addr = this.fetch16();
        const { bank: effBank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexY());
        if (this.m8) {
          const m = this.read8(effBank, eff);
this.dbg(`[ADC abs,Y] m8=1 DBR=$${(effBank & 0xff).toString(16).padStart(2,'0')} addr=$${eff.toString(16).padStart(4,'0')} A_pre=$${(this.state.A & 0xff).toString(16).padStart(2,'0')} m=$${m.toString(16).padStart(2,'0')}`);
          this.adc(m);
          this.dbg(`[ADC abs,Y] -> A=$${(this.state.A & 0xff).toString(16).padStart(2,'0')} P=$${(this.state.P & 0xff).toString(16).padStart(2,'0')}`);
        } else {
          const m = this.read16(effBank, eff);
this.dbg(`[ADC abs,Y] m8=0 DBR=$${(effBank & 0xff).toString(16).padStart(2,'0')} addr=$${eff.toString(16).padStart(4,'0')} A_pre=$${(this.state.A & 0xffff).toString(16).padStart(4,'0')} m16=$${m.toString(16).padStart(4,'0')}`);
          this.adc(m);
          this.dbg(`[ADC abs,Y] -> A=$${(this.state.A & 0xffff).toString(16).padStart(4,'0')} P=$${(this.state.P & 0xff).toString(16).padStart(2,'0')}`);
        }
        break;
      }
      case 0x61: { // ADC (dp,X)
        const dp = this.fetch8();
        const off = (((dp & 0xff) + (this.state.X & 0xff)) & 0xff);
        const eff = this.dpPtr16(off);
        if (this.m8) {
          const m = this.read8(this.state.DBR, eff);
          this.dbg(`[ADC(indX)] m8=1 DBR=$${this.state.DBR.toString(16).padStart(2,'0')} eff=$${eff.toString(16).padStart(4,'0')} val8=$${m.toString(16).padStart(2,'0')}`);
          this.adc(m);
          this.dbg(`[ADC(indX)] -> A=$${(this.state.A & 0xff).toString(16).padStart(2,'0')} P=$${(this.state.P & 0xff).toString(16).padStart(2,'0')}`);
        } else {
          const val16 = this.read16(this.state.DBR, eff);
          this.dbg(`[ADC(indX)] m8=0 DBR=$${this.state.DBR.toString(16).padStart(2,'0')} eff=$${eff.toString(16).padStart(4,'0')} val16=$${val16.toString(16).padStart(4,'0')}`);
          this.adc(val16);
          this.dbg(`[ADC(indX)] -> A=$${(this.state.A & 0xffff).toString(16).padStart(4,'0')} P=$${(this.state.P & 0xff).toString(16).padStart(2,'0')}`);
        }
        break;
      }
      case 0x72: { // ADC (dp)
        const dp = this.fetch8();
        const eff = this.dpPtr16(dp);
        if (this.m8) {
          const m = this.read8(this.state.DBR, eff);
          this.adc(m);
        } else {
          const m = this.read16(this.state.DBR, eff);
          this.adc(m);
        }
        break;
      }
      case 0x63: { // ADC sr (stack relative)
        const sr = this.fetch8();
        const base = this.srBase();
        const eff = (base + (sr & 0xff)) & 0xffff;
        if (this.m8) {
          const m = this.read8(0x00, eff as Word);
          this.adc(m);
        } else {
          const m = this.read16(0x00, eff as Word);
          this.adc(m);
        }
        break;
      }
      case 0x71: { // ADC (dp),Y
        const dp = this.fetch8();
        const basePtr = this.dpPtr16(dp);
        const idx = this.indexY();
        const { bank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, basePtr as Word, idx);
        if (this.m8) {
          const m = this.read8(bank, eff);
          this.dbg(`[ADC (dp),Y] m8=1 DBR=$${(bank & 0xff).toString(16).padStart(2,'0')} base=$${(basePtr & 0xffff).toString(16).padStart(4,'0')} idx=$${(idx & 0xffff).toString(16).padStart(4,'0')} eff=$${eff.toString(16).padStart(4,'0')} Y=$${(this.state.Y & 0xff).toString(16).padStart(2,'0')} A_pre=$${(this.state.A & 0xff).toString(16).padStart(2,'0')} m=$${m.toString(16).padStart(2,'0')}`);
          this.adc(m);
          this.dbg(`[ADC (dp),Y] -> A=$${(this.state.A & 0xff).toString(16).padStart(2,'0')} P=$${(this.state.P & 0xff).toString(16).padStart(2,'0')}`);
        } else {
          const m = this.read16(bank, eff);
          this.dbg(`[ADC (dp),Y] m8=0 DBR=$${(bank & 0xff).toString(16).padStart(2,'0')} base=$${(basePtr & 0xffff).toString(16).padStart(4,'0')} idx=$${(idx & 0xffff).toString(16).padStart(4,'0')} eff=$${eff.toString(16).padStart(4,'0')} Y=$${(this.state.Y & (this.x8?0xff:0xffff)).toString(16).padStart(this.x8?2:4,'0')} A_pre=$${(this.state.A & 0xffff).toString(16).padStart(4,'0')} m16=$${m.toString(16).padStart(4,'0')}`);
          this.adc(m);
          this.dbg(`[ADC (dp),Y] -> A=$${(this.state.A & 0xffff).toString(16).padStart(4,'0')} P=$${(this.state.P & 0xff).toString(16).padStart(2,'0')}`);
        }
        break;
      }
      case 0x73: { // ADC (sr),Y
        const sr = this.fetch8();
        const { bank, addr: eff } = this.effSRY(sr);
        if (this.m8) {
          const m = this.read8(bank, eff);
          this.dbg(`[ADC (sr),Y] m8=1 DBR=$${bank.toString(16).padStart(2,'0')} eff=$${eff.toString(16).padStart(4,'0')} A_pre=$${(this.state.A & 0xff).toString(16).padStart(2,'0')} m=$${m.toString(16).padStart(2,'0')}`);
          this.adc(m);
          this.dbg(`[ADC (sr),Y] -> A=$${(this.state.A & 0xff).toString(16).padStart(2,'0')} P=$${(this.state.P & 0xff).toString(16).padStart(2,'0')}`);
        } else {
          const m = this.read16(bank, eff);
          this.dbg(`[ADC (sr),Y] m8=0 DBR=$${bank.toString(16).padStart(2,'0')} eff=$${eff.toString(16).padStart(4,'0')} A_pre=$${(this.state.A & 0xffff).toString(16).padStart(4,'0')} m16=$${m.toString(16).padStart(4,'0')}`);
          this.adc(m);
          this.dbg(`[ADC (sr),Y] -> A=$${(this.state.A & 0xffff).toString(16).padStart(4,'0')} P=$${(this.state.P & 0xff).toString(16).padStart(2,'0')}`);
        }
        break;
      }
      case 0x6f: { // ADC long
        const lo = this.fetch8();
        const hi = this.fetch8();
        const bank = this.fetch8() & 0xff;
        const addr = ((hi << 8) | lo) & 0xffff;
        if (this.m8) {
          const m = this.read8(bank, addr);
          this.adc(m);
        } else {
          const m = this.read16Cross(bank, addr);
          this.adc(m);
        }
        break;
      }
      case 0x7f: { // ADC long,X
        const lo = this.fetch8();
        const hi = this.fetch8();
        const bank = this.fetch8() & 0xff;
        const base = ((hi << 8) | lo) & 0xffff;
        // Long indexed carries into bank on overflow
        const sum24 = (bank << 16) | base;
        const indexed24 = sum24 + this.indexX();
        const effBank = (indexed24 >> 16) & 0xff;
        const effAddr = indexed24 & 0xffff;
        if (this.m8) {
          const m = this.read8(effBank, effAddr);
          this.adc(m);
        } else {
          const m = this.read16Cross(effBank, effAddr);
          this.adc(m);
        }
        break;
      }
      case 0x67: { // ADC [dp]
        const dp = this.fetch8();
        const { bank, addr } = this.dpPtrLong(dp);
        if (this.m8) {
          const m = this.read8(bank, addr);
          this.dbg(`[ADC [dp]] m8=1 dp=$${(dp&0xff).toString(16).padStart(2,'0')} -> (${bank.toString(16).padStart(2,'0')}:${addr.toString(16).padStart(4,'0')}) A_pre=$${(this.state.A & 0xff).toString(16).padStart(2,'0')} P=$${(this.state.P & 0xff).toString(16).padStart(2,'0')} m=$${m.toString(16).padStart(2,'0')}`);
          this.adc(m);
        } else {
          const m = this.read16Cross(bank, addr);
          this.dbg(`[ADC [dp]] m8=0 dp=$${(dp&0xff).toString(16).padStart(2,'0')} -> (${bank.toString(16).padStart(2,'0')}:${addr.toString(16).padStart(4,'0')}) A_pre=$${(this.state.A & 0xffff).toString(16).padStart(4,'0')} P=$${(this.state.P & 0xff).toString(16).padStart(2,'0')} m16=$${m.toString(16).padStart(4,'0')}`);
          this.adc(m);
        }
        break;
      }
      case 0x77: { // ADC [dp],Y
        const dp = this.fetch8();
        const { bank, addr } = this.effLongDPY(dp);
        if (this.m8) {
          const m = this.read8(bank, addr);
          this.dbg(`[ADC [dp],Y] m8=1 dp=$${(dp&0xff).toString(16).padStart(2,'0')} -> (${bank.toString(16).padStart(2,'0')}:${addr.toString(16).padStart(4,'0')}) A_pre=$${(this.state.A & 0xff).toString(16).padStart(2,'0')} P=$${(this.state.P & 0xff).toString(16).padStart(2,'0')} m=$${m.toString(16).padStart(2,'0')}`);
          this.adc(m);
        } else {
          const m = this.read16Cross(bank, addr);
          this.dbg(`[ADC [dp],Y] m8=0 dp=$${(dp&0xff).toString(16).padStart(2,'0')} -> (${bank.toString(16).padStart(2,'0')}:${addr.toString(16).padStart(4,'0')}) A_pre=$${(this.state.A & 0xffff).toString(16).padStart(4,'0')} P=$${(this.state.P & 0xff).toString(16).padStart(2,'0')} m16=$${m.toString(16).padStart(4,'0')}`);
          this.adc(m);
        }
        break;
      }

      // SBC #imm (decimal off)
      case 0xe9: {
        if (this.m8) {
          const imm = this.fetch8();
          this.sbc(imm);
        } else {
          const imm = this.fetch16();
          this.sbc(imm);
        }
        break;
      }
      // SBC memory forms
      case 0xe5: { // SBC dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.m8) {
          const m = this.read8(0x00, eff);
          this.sbc(m);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = ((hi << 8) | lo) & 0xffff;
          this.sbc(m);
        }
        break;
      }
      case 0xf5: { // SBC dp,X
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, true);
        if (this.m8) {
          const m = this.read8(0x00, eff);
          this.sbc(m);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = ((hi << 8) | lo) & 0xffff;
          this.sbc(m);
        }
        break;
      }
      case 0xed: { // SBC abs
        const addr = this.fetch16();
        if (this.m8) {
          const m = this.read8(this.state.DBR, addr);
          this.sbc(m);
        } else {
          const m = this.read16(this.state.DBR, addr);
          this.sbc(m);
        }
        break;
      }
      case 0xfd: { // SBC abs,X
        const addr = this.fetch16();
        const { bank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexX());
        if (this.m8) {
          const m = this.read8(bank, eff);
          this.sbc(m);
        } else {
          const m = this.read16(bank, eff);
          this.sbc(m);
        }
        break;
      }
      case 0xf9: { // SBC abs,Y
        const addr = this.fetch16();
        const { bank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexY());
        if (this.m8) {
          const m = this.read8(bank, eff);
          this.sbc(m);
        } else {
          const m = this.read16(bank, eff);
          this.sbc(m);
        }
        break;
      }
      case 0xe1: { // SBC (dp,X)
        const dp = this.fetch8();
        const off = (((dp & 0xff) + (this.state.X & 0xff)) & 0xff);
        const eff = this.dpPtr16(off);
        if (this.m8) {
          const m = this.read8(this.state.DBR, eff);
          this.sbc(m);
        } else {
          const m = this.read16(this.state.DBR, eff);
          this.sbc(m);
        }
        break;
      }
      case 0xf2: { // SBC (dp)
        const dp = this.fetch8();
        const eff = this.dpPtr16(dp);
        if (this.m8) {
          const m = this.read8(this.state.DBR, eff);
          this.sbc(m);
        } else {
          const m = this.read16(this.state.DBR, eff);
          this.sbc(m);
        }
        break;
      }
      case 0xe3: { // SBC sr
        const sr = this.fetch8();
        const base = this.srBase();
        const eff = (base + (sr & 0xff)) & 0xffff;
        if (this.m8) {
          const m = this.read8(0x00, eff as Word);
          this.sbc(m);
        } else {
          const m = this.read16(0x00, eff as Word);
          this.sbc(m);
        }
        break;
      }
      case 0xf1: { // SBC (dp),Y
        const dp = this.fetch8();
        const { bank, addr: eff } = this.effIndDPY(dp);
        if (this.m8) {
          const m = this.read8(bank, eff);
          this.sbc(m);
        } else {
          const m = this.read16(bank, eff);
          this.sbc(m);
        }
        break;
      }
      case 0xf3: { // SBC (sr),Y
        const sr = this.fetch8();
        const { bank, addr: eff } = this.effSRY(sr);
        if (this.m8) {
          const m = this.read8(bank, eff);
          this.sbc(m);
        } else {
          const m = this.read16(bank, eff);
          this.sbc(m);
        }
        break;
      }
      case 0xef: { // SBC long
        const lo = this.fetch8();
        const hi = this.fetch8();
        const bank = this.fetch8() & 0xff;
        const addr = ((hi << 8) | lo) & 0xffff;
        if (this.m8) {
          const m = this.read8(bank, addr);
          this.sbc(m);
        } else {
          const m = this.read16Cross(bank, addr);
          this.sbc(m);
        }
        break;
      }
      case 0xff: { // SBC long,X
        const lo = this.fetch8();
        const hi = this.fetch8();
        const bank = this.fetch8() & 0xff;
        const base = ((hi << 8) | lo) & 0xffff;
        // Long indexed carries into bank on overflow
        const sum24 = (bank << 16) | base;
        const indexed24 = sum24 + this.indexX();
        const effBank = (indexed24 >> 16) & 0xff;
        const effAddr = indexed24 & 0xffff;
        if (this.m8) {
          const m = this.read8(effBank, effAddr);
          this.sbc(m);
        } else {
          const m = this.read16Cross(effBank, effAddr);
          this.sbc(m);
        }
        break;
      }
      case 0xe7: { // SBC [dp]
        const dp = this.fetch8();
        const ptr = (this.state.D + dp) & 0xffff;
        const lo = this.read8(0x00, ptr);
        const hi = this.read8(0x00, (ptr + 1) & 0xffff);
        const bank = this.read8(0x00, (ptr + 2) & 0xffff) & 0xff;
        const addr = ((hi << 8) | lo) & 0xffff;
        if (this.m8) {
          const m = this.read8(bank, addr);
          this.sbc(m);
        } else {
          const m = this.read16Cross(bank, addr);
          this.sbc(m);
        }
        break;
      }
      case 0xf7: { // SBC [dp],Y
        const dp = this.fetch8();
        const { bank, addr } = this.effLongDPY(dp);
        if (this.m8) {
          const m = this.read8(bank, addr);
          this.sbc(m);
        } else {
          const m = this.read16Cross(bank, addr);
          this.sbc(m);
        }
        break;
      }

      // BRK: vector depends on E (emulation/native)
      case 0x00: {
        // Push PC (high, low) and P
        const pc = this.state.PC;
        this.push8((pc >>> 8) & 0xff);
        this.push8(pc & 0xff);
        this.push8(this.state.P);
        // Set I flag and dispatch
        this.state.P |= Flag.I;
        const vecLoAddr = this.state.E ? 0xfffe : 0xffe6; // emu BRK/IRQ vs native BRK
        const vecHiAddr = (vecLoAddr + 1) & 0xffff;
        const lo = this.read8(0x00, vecLoAddr as Word);
        const hi = this.read8(0x00, vecHiAddr as Word);
        this.state.PBR = 0x00;
        this.state.PC = ((hi << 8) | lo) & 0xffff;
        break;
      }

      // COP: software interrupt, vector depends on E
      case 0x02: {
        const pc = this.state.PC;
        this.push8((pc >>> 8) & 0xff);
        this.push8(pc & 0xff);
        this.push8(this.state.P);
        this.state.P |= Flag.I;
        const vecLoAddr = this.state.E ? 0xfff4 : 0xffe4;
        const vecHiAddr = (vecLoAddr + 1) & 0xffff;
        const lo = this.read8(0x00, vecLoAddr as Word);
        const hi = this.read8(0x00, vecHiAddr as Word);
        this.state.PBR = 0x00;
        this.state.PC = ((hi << 8) | lo) & 0xffff;
        break;
      }

      // RTI: pull P, then PC low, PC high (emulation mode)
      case 0x40: {
        this.state.P = this.pull8();
        this.updateWidthConstraintsForE();
        this.applyWidthAfterPChange();
        const pcl = this.pull8();
        const pch = this.pull8();
        this.state.PC = ((pch << 8) | pcl) & 0xffff;
        break;
      }

      // XBA (exchange A low/high bytes)
      case 0xeb: {
        const lo = this.state.A & 0xff;
        const hi = (this.state.A >>> 8) & 0xff;
        const newA = ((lo << 8) | hi) & 0xffff;
        this.state.A = newA;
        this.setZNFromValue(this.state.A & 0xff, 8);
        break;
      }

      // Shifts/rotates accumulator (E-mode, 8-bit)
      case 0x0a: // ASL A
        this.aslA();
        break;
      case 0x4a: // LSR A
        this.lsrA();
        break;
      case 0x2a: // ROL A
        this.rolA();
        break;
      case 0x6a: // ROR A
        this.rorA();
        break;

      // Increment/decrement accumulator
      case 0x1a: { // INA (INC A)
        if (this.m8) {
          const a = (this.state.A + 1) & 0xff;
          this.state.A = (this.state.A & 0xff00) | a;
          this.setZNFromValue(a, 8);
        } else {
          const a = (this.state.A + 1) & 0xffff;
          this.state.A = a;
          this.setZNFromValue(a, 16);
        }
        break;
      }
      case 0x3a: { // DEA (DEC A)
        if (this.m8) {
          const a = (this.state.A - 1) & 0xff;
          this.state.A = (this.state.A & 0xff00) | a;
          this.setZNFromValue(a, 8);
        } else {
          const a = (this.state.A - 1) & 0xffff;
          this.state.A = a;
          this.setZNFromValue(a, 16);
        }
        break;
      }

      // BIT/TSB/TRB (E-mode 8-bit; 16-bit if native M=0)
      case 0x89: { // BIT #imm
        if (this.m8) {
          const imm = this.fetch8();
          const res = (this.state.A & 0xff) & imm;
          if (res === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
          // N and V are unaffected for BIT immediate
        } else {
          const imm = this.fetch16();
          const res = (this.state.A & 0xffff) & imm;
          if (res === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
          // N and V are unaffected for BIT immediate
        }
        break;
      }
      case 0x24: { // BIT dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.m8) {
          const m = this.read8(0x00, eff);
          const res = (this.state.A & 0xff) & m;
          if (res === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
          // N from bit7, V from bit6 of memory
          if ((m & 0x80) !== 0) this.state.P |= Flag.N; else this.state.P &= ~Flag.N;
          if ((m & 0x40) !== 0) this.state.P |= Flag.V; else this.state.P &= ~Flag.V;
        } else {
const m = this.read16(0x00, eff);
          const res = (this.state.A & 0xffff) & m;
          if (res === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
          if ((m & 0x8000) !== 0) this.state.P |= Flag.N; else this.state.P &= ~Flag.N;
          if ((m & 0x4000) !== 0) this.state.P |= Flag.V; else this.state.P &= ~Flag.V;
        }
        break;
      }
      case 0x2c: { // BIT abs
        const addr = this.fetch16();
        if (this.m8) {
          const m = this.read8(this.state.DBR, addr);
          const res = (this.state.A & 0xff) & m;
          if (res === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
          if ((m & 0x80) !== 0) this.state.P |= Flag.N; else this.state.P &= ~Flag.N;
          if ((m & 0x40) !== 0) this.state.P |= Flag.V; else this.state.P &= ~Flag.V;
        } else {
const m = this.read16(this.state.DBR, addr);
          const res = (this.state.A & 0xffff) & m;
          if (res === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
          if ((m & 0x8000) !== 0) this.state.P |= Flag.N; else this.state.P &= ~Flag.N;
          if ((m & 0x4000) !== 0) this.state.P |= Flag.V; else this.state.P &= ~Flag.V;
        }
        break;
      }
      case 0x34: { // BIT dp,X
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, true);
        if (this.m8) {
          const m = this.read8(0x00, eff);
          const res = (this.state.A & 0xff) & m;
          if (res === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
          if ((m & 0x80) !== 0) this.state.P |= Flag.N; else this.state.P &= ~Flag.N;
          if ((m & 0x40) !== 0) this.state.P |= Flag.V; else this.state.P &= ~Flag.V;
        } else {
          const m = this.read16(0x00, eff);
          const res = (this.state.A & 0xffff) & m;
          if (res === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
          if ((m & 0x8000) !== 0) this.state.P |= Flag.N; else this.state.P &= ~Flag.N;
          if ((m & 0x4000) !== 0) this.state.P |= Flag.V; else this.state.P &= ~Flag.V;
        }
        break;
      }
      case 0x3c: { // BIT abs,X
        const addr = this.fetch16();
        const { bank: effBank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexX());
        if (this.m8) {
          const m = this.read8(effBank, eff);
          const res = (this.state.A & 0xff) & m;
          if (res === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
          if ((m & 0x80) !== 0) this.state.P |= Flag.N; else this.state.P &= ~Flag.N;
          if ((m & 0x40) !== 0) this.state.P |= Flag.V; else this.state.P &= ~Flag.V;
        } else {
          const m = this.read16(effBank, eff);
          const res = (this.state.A & 0xffff) & m;
          if (res === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
          if ((m & 0x8000) !== 0) this.state.P |= Flag.N; else this.state.P &= ~Flag.N;
          if ((m & 0x4000) !== 0) this.state.P |= Flag.V; else this.state.P &= ~Flag.V;
        }
        break;
      }
      case 0x04: { // TSB dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.m8) {
          const m = this.read8(0x00, eff);
          const a = this.state.A & 0xff;
          const res = a & m;
          if (res === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
          const newM = m | a;
          this.write8(0x00, eff, newM);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = ((hi << 8) | lo) & 0xffff;
          const a = this.state.A & 0xffff;
          const res = a & m;
          if (res === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
          const newM = m | a;
          this.write16(0x00, eff, newM & 0xffff);
        }
        break;
      }
      case 0x0c: { // TSB abs
        const addr = this.fetch16();
        if (this.m8) {
          const m = this.read8(this.state.DBR, addr);
          const a = this.state.A & 0xff;
          const res = a & m;
          if (res === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
          const newM = m | a;
          this.write8(this.state.DBR, addr, newM & 0xff);
        } else {
const m = this.read16(this.state.DBR, addr);
          const a = this.state.A & 0xffff;
          const res = a & m;
          if (res === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
          const newM = m | a;
this.write16Cross(this.state.DBR, addr, newM & 0xffff);
        }
        break;
      }
      case 0x14: { // TRB dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.m8) {
          const m = this.read8(0x00, eff);
          const a = this.state.A & 0xff;
          const res = a & m;
          if (res === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
          const newM = m & (~a & 0xff);
          this.write8(0x00, eff, newM & 0xff);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = ((hi << 8) | lo) & 0xffff;
          const a = this.state.A & 0xffff;
          const res = a & m;
          if (res === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
          const newM = m & (~a & 0xffff);
          this.write16(0x00, eff, newM & 0xffff);
        }
        break;
      }
      case 0x1c: { // TRB abs
        const addr = this.fetch16();
        if (this.m8) {
          const m = this.read8(this.state.DBR, addr);
          const a = this.state.A & 0xff;
          const res = a & m;
          if (res === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
          const newM = m & (~a & 0xff);
          this.write8(this.state.DBR, addr, newM & 0xff);
        } else {
const m = this.read16(this.state.DBR, addr);
          const a = this.state.A & 0xffff;
          const res = a & m;
          if (res === 0) this.state.P |= Flag.Z; else this.state.P &= ~Flag.Z;
          const newM = m & (~a & 0xffff);
this.write16Cross(this.state.DBR, addr, newM & 0xffff);
        }
        break;
      }

      // Memory RMW helpers for 8/16-bit A (use M width)
      case 0x06: { // ASL dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.m8) {
          const m = this.read8(0x00, eff);
          const c = (m & 0x80) !== 0;
          const res = (m << 1) & 0xff;
          this.write8(0x00, eff, res);
          if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = ((hi << 8) | lo) & 0xffff;
          const c = (m & 0x8000) !== 0;
          const res = (m << 1) & 0xffff;
          this.write16(0x00, eff, res & 0xffff);
          if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x16: { // ASL dp,X
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, true);
        if (this.m8) {
          const m = this.read8(0x00, eff);
          const c = (m & 0x80) !== 0;
          const res = (m << 1) & 0xff;
          this.write8(0x00, eff, res);
          if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = ((hi << 8) | lo) & 0xffff;
          const c = (m & 0x8000) !== 0;
          const res = (m << 1) & 0xffff;
          this.write16(0x00, eff, res & 0xffff);
          if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x0e: { // ASL abs
        const addr = this.fetch16();
        if (this.m8) {
          const m = this.read8(this.state.DBR, addr);
          const c = (m & 0x80) !== 0;
          const res = (m << 1) & 0xff;
          this.dbg(`[ASL abs] m8=1 DBR=$${(this.state.DBR & 0xff).toString(16).padStart(2,'0')} addr=$${addr.toString(16).padStart(4,'0')} m=$${m.toString(16).padStart(2,'0')} -> res=$${res.toString(16).padStart(2,'0')}`);
          this.write8(this.state.DBR, addr, res);
          if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(this.state.DBR, addr);
          const c = (m & 0x8000) !== 0;
          const res = (m << 1) & 0xffff;
          this.dbg(`[ASL abs] m8=0 DBR=$${(this.state.DBR & 0xff).toString(16).padStart(2,'0')} addr=$${addr.toString(16).padStart(4,'0')} m16=$${m.toString(16).padStart(4,'0')} -> res16=$${res.toString(16).padStart(4,'0')}`);
          // Non-long absolute addressing writes remain within the same bank and wrap at $FFFF -> $0000
          this.write16Cross(this.state.DBR, addr, res & 0xffff);
          if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x1e: { // ASL abs,X
        const addr = this.fetch16();
        const { bank: effBank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexX());
        if (this.m8) {
          const m = this.read8(effBank, eff);
          const c = (m & 0x80) !== 0;
          const res = (m << 1) & 0xff;
          this.write8(effBank, eff, res);
          if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(effBank, eff);
          const c = (m & 0x8000) !== 0;
          const res = (m << 1) & 0xffff;
          this.write16Cross(effBank, eff, res & 0xffff);
          if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 16);
        }
        break;
      }

      // LSR
      case 0x46: { // LSR dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.m8) {
          const m = this.read8(0x00, eff);
          const c = (m & 1) !== 0;
          const res = (m >>> 1) & 0xff;
          this.write8(0x00, eff, res);
          if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = ((hi << 8) | lo) & 0xffff;
          const c = (m & 1) !== 0;
          const res = (m >>> 1) & 0xffff;
          this.write8(0x00, eff, res & 0xff);
          this.write8(0x00, (eff + 1) & 0xffff, (res >>> 8) & 0xff);
          if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x56: { // LSR dp,X
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, true);
        if (this.m8) {
          const m = this.read8(0x00, eff);
          const c = (m & 1) !== 0;
          const res = (m >>> 1) & 0xff;
          this.write8(0x00, eff, res);
          if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = ((hi << 8) | lo) & 0xffff;
          const c = (m & 1) !== 0;
          const res = (m >>> 1) & 0xffff;
          this.write8(0x00, eff, res & 0xff);
          this.write8(0x00, (eff + 1) & 0xffff, (res >>> 8) & 0xff);
          if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x4e: { // LSR abs
        const addr = this.fetch16();
        if (this.m8) {
          const m = this.read8(this.state.DBR, addr);
          const c = (m & 1) !== 0;
          const res = (m >>> 1) & 0xff;
          this.write8(this.state.DBR, addr, res);
          if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(this.state.DBR, addr);
          const c = (m & 1) !== 0;
          const res = (m >>> 1) & 0xffff;
          // Non-long absolute addressing writes remain within the same bank and wrap at $FFFF -> $0000
          this.write16Cross(this.state.DBR, addr, res & 0xffff);
          if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x5e: { // LSR abs,X
        const addr = this.fetch16();
        const { bank: effBank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexX());
        if (this.m8) {
          const m = this.read8(effBank, eff);
          const c = (m & 1) !== 0;
          const res = (m >>> 1) & 0xff;
          this.write8(effBank, eff, res);
          if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(effBank, eff);
          const c = (m & 1) !== 0;
          const res = (m >>> 1) & 0xffff;
          this.write16Cross(effBank, eff, res & 0xffff);
          if (c) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 16);
        }
        break;
      }

      // ROL
      case 0x26: { // ROL dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        const carryIn = (this.state.P & Flag.C) ? 1 : 0;
        if (this.m8) {
          const m = this.read8(0x00, eff);
          const newC = (m & 0x80) !== 0;
          const res = ((m << 1) & 0xff) | carryIn;
          this.write8(0x00, eff, res);
          if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = ((hi << 8) | lo) & 0xffff;
          const newC = (m & 0x8000) !== 0;
          const res = ((m << 1) & 0xffff) | carryIn;
          this.write16(0x00, eff, res & 0xffff);
          if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x36: { // ROL dp,X
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, true);
        const carryIn = (this.state.P & Flag.C) ? 1 : 0;
        if (this.m8) {
          const m = this.read8(0x00, eff);
          const newC = (m & 0x80) !== 0;
          const res = ((m << 1) & 0xff) | carryIn;
          this.write8(0x00, eff, res);
          if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = ((hi << 8) | lo) & 0xffff;
          const newC = (m & 0x8000) !== 0;
          const res = ((m << 1) & 0xffff) | carryIn;
          this.write16(0x00, eff, res & 0xffff);
          if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x2e: { // ROL abs
        const addr = this.fetch16();
        const carryIn = (this.state.P & Flag.C) ? 1 : 0;
        if (this.m8) {
          const m = this.read8(this.state.DBR, addr);
          const newC = (m & 0x80) !== 0;
          const res = ((m << 1) & 0xff) | carryIn;
          this.write8(this.state.DBR, addr, res);
          if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 8);
        } else {
const m = this.read16(this.state.DBR, addr);
          const newC = (m & 0x8000) !== 0;
          const res = ((m << 1) & 0xffff) | carryIn;
          this.write16Cross(this.state.DBR, addr, res & 0xffff);
          if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x3e: { // ROL abs,X
        const addr = this.fetch16();
        const { bank: effBank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexX());
        const carryIn = (this.state.P & Flag.C) ? 1 : 0;
        if (this.m8) {
          const m = this.read8(effBank, eff);
          const newC = (m & 0x80) !== 0;
          const res = ((m << 1) & 0xff) | carryIn;
          this.write8(effBank, eff, res);
          if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(effBank, eff);
          const newC = (m & 0x8000) !== 0;
          const res = ((m << 1) & 0xffff) | carryIn;
          this.write16Cross(effBank, eff, res & 0xffff);
          if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 16);
        }
        break;
      }

      // ROR
      case 0x66: { // ROR dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        const carryIn = (this.state.P & Flag.C) ? (this.m8 ? 0x80 : 0x8000) : 0;
        if (this.m8) {
          const m = this.read8(0x00, eff);
          const newC = (m & 1) !== 0;
          const res = ((m >>> 1) | ((this.state.P & Flag.C) ? 0x80 : 0)) & 0xff;
          this.write8(0x00, eff, res);
          if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = ((hi << 8) | lo) & 0xffff;
          const newC = (m & 1) !== 0;
          const res = ((m >>> 1) | carryIn) & 0xffff;
          this.write16(0x00, eff, res & 0xffff);
          if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x76: { // ROR dp,X
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, true);
        const carryIn = (this.state.P & Flag.C) ? (this.m8 ? 0x80 : 0x8000) : 0;
        if (this.m8) {
          const m = this.read8(0x00, eff);
          const newC = (m & 1) !== 0;
          const res = ((m >>> 1) | ((this.state.P & Flag.C) ? 0x80 : 0)) & 0xff;
          this.write8(0x00, eff, res);
          if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = ((hi << 8) | lo) & 0xffff;
          const newC = (m & 1) !== 0;
          const res = ((m >>> 1) | carryIn) & 0xffff;
          this.write8(0x00, eff, res & 0xff);
          this.write8(0x00, (eff + 1) & 0xffff, (res >>> 8) & 0xff);
          if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x6e: { // ROR abs
        const addr = this.fetch16();
        const carryIn = (this.state.P & Flag.C) ? (this.m8 ? 0x80 : 0x8000) : 0;
        if (this.m8) {
          const m = this.read8(this.state.DBR, addr);
          const newC = (m & 1) !== 0;
          const res = ((m >>> 1) | ((this.state.P & Flag.C) ? 0x80 : 0)) & 0xff;
          this.write8(this.state.DBR, addr, res);
          if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(this.state.DBR, addr);
          const newC = (m & 1) !== 0;
          const res = ((m >>> 1) | carryIn) & 0xffff;
          this.write16Cross(this.state.DBR, addr, res & 0xffff);
          if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x7e: { // ROR abs,X
        const addr = this.fetch16();
        const { bank: effBank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexX());
        const carryIn = (this.state.P & Flag.C) ? (this.m8 ? 0x80 : 0x8000) : 0;
        if (this.m8) {
          const m = this.read8(effBank, eff);
          const newC = (m & 1) !== 0;
          const res = ((m >>> 1) | ((this.state.P & Flag.C) ? 0x80 : 0)) & 0xff;
          this.write8(effBank, eff, res);
          if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(effBank, eff);
          const newC = (m & 1) !== 0;
          const res = ((m >>> 1) | carryIn) & 0xffff;
          this.write16Cross(effBank, eff, res & 0xffff);
          if (newC) this.state.P |= Flag.C; else this.state.P &= ~Flag.C;
          this.setZNFromValue(res, 16);
        }
        break;
      }

      // INC/DEC memory
      case 0xe6: { // INC dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.m8) {
          const m = (this.read8(0x00, eff) + 1) & 0xff;
          this.write8(0x00, eff, m);
          this.setZNFromValue(m, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = (((hi << 8) | lo) + 1) & 0xffff;
          this.write16(0x00, eff, m & 0xffff);
          this.setZNFromValue(m, 16);
        }
        break;
      }
      case 0xf6: { // INC dp,X
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, true);
        if (this.m8) {
          const m = (this.read8(0x00, eff) + 1) & 0xff;
          this.write8(0x00, eff, m);
          this.setZNFromValue(m, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = (((hi << 8) | lo) + 1) & 0xffff;
          this.write16(0x00, eff, m & 0xffff);
          this.setZNFromValue(m, 16);
        }
        break;
      }
      case 0xee: { // INC abs
        const addr = this.fetch16();
        if (this.m8) {
          const m = (this.read8(this.state.DBR, addr) + 1) & 0xff;
          this.write8(this.state.DBR, addr, m);
          this.setZNFromValue(m, 8);
        } else {
          const mPrev = this.read16(this.state.DBR, addr);
          const m = (mPrev + 1) & 0xffff;
          // Non-long absolute addressing writes remain within the same bank and wrap at $FFFF -> $0000
          this.write16Cross(this.state.DBR, addr, m & 0xffff);
          this.setZNFromValue(m, 16);
        }
        break;
      }
      case 0xfe: { // INC abs,X
        const addr = this.fetch16();
        const { bank: effBank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexX());
        if (this.m8) {
          const m = (this.read8(effBank, eff) + 1) & 0xff;
          this.write8(effBank, eff, m);
          this.setZNFromValue(m, 8);
        } else {
          const m = (this.read16(effBank, eff) + 1) & 0xffff;
          this.write16Cross(effBank, eff, m & 0xffff);
          this.setZNFromValue(m, 16);
        }
        break;
      }
      case 0xc6: { // DEC dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.m8) {
          const m = (this.read8(0x00, eff) - 1) & 0xff;
          this.write8(0x00, eff, m);
          this.setZNFromValue(m, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = (((hi << 8) | lo) - 1) & 0xffff;
          this.write16(0x00, eff, m & 0xffff);
          this.setZNFromValue(m, 16);
        }
        break;
      }
      case 0xd6: { // DEC dp,X
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, true);
        if (this.m8) {
          const m = (this.read8(0x00, eff) - 1) & 0xff;
          this.write8(0x00, eff, m);
          this.setZNFromValue(m, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = (((hi << 8) | lo) - 1) & 0xffff;
          this.write8(0x00, eff, m & 0xff);
          this.write8(0x00, (eff + 1) & 0xffff, (m >>> 8) & 0xff);
          this.setZNFromValue(m, 16);
        }
        break;
      }
      case 0xce: { // DEC abs
        const addr = this.fetch16();
        if (this.m8) {
          const m = (this.read8(this.state.DBR, addr) - 1) & 0xff;
          this.write8(this.state.DBR, addr, m);
          this.setZNFromValue(m, 8);
        } else {
          const mPrev = this.read16(this.state.DBR, addr);
          const m = (mPrev - 1) & 0xffff;
          // Non-long absolute addressing writes remain within the same bank and wrap at $FFFF -> $0000
          this.write16Cross(this.state.DBR, addr, m & 0xffff);
          this.setZNFromValue(m, 16);
        }
        break;
      }
      case 0xde: { // DEC abs,X
        const addr = this.fetch16();
        const { bank: effBank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexX());
        if (this.m8) {
          const m = (this.read8(effBank, eff) - 1) & 0xff;
          this.write8(effBank, eff, m);
          this.setZNFromValue(m, 8);
        } else {
          const m = (this.read16(effBank, eff) - 1) & 0xffff;
          this.write16Cross(effBank, eff, m & 0xffff);
          this.setZNFromValue(m, 16);
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

      // CLI/SEI (clear/set interrupt)
      case 0x58: // CLI
        this.state.P &= ~Flag.I;
        break;
      case 0x78: // SEI
        this.state.P |= Flag.I;
        break;

      // CLD/SED (clear/set decimal)
      case 0xd8: // CLD
        this.state.P &= ~Flag.D;
        break;
      case 0xf8: // SED
        this.state.P |= Flag.D;
        break;

      // CLV (clear overflow)
      case 0xb8:
        this.state.P &= ~Flag.V;
        break;

      // WAI/STP (low-power)
      case 0xcb: { // WAI
        this.waitingForInterrupt = true;
        break;
      }
      case 0xdb: { // STP
        this.stopped = true;
        break;
      }

      // REP / SEP (clear/set bits in P)
      case 0xc2: { // REP #imm8
        const m = this.fetch8();
        this.state.P &= ~m;
        this.updateWidthConstraintsForE();
        this.applyWidthAfterPChange();
        break;
      }
      case 0xe2: { // SEP #imm8
        const m = this.fetch8();
        this.state.P |= m;
        this.updateWidthConstraintsForE();
        this.applyWidthAfterPChange();
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
        this.applyWidthAfterPChange();
        break;
      }

      // BEQ/BNE/BCC/BCS/BPL/BMI relative
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
      case 0x90: { // BCC
        const off = this.fetch8() << 24 >> 24;
        if ((this.state.P & Flag.C) === 0) this.state.PC = (this.state.PC + off) & 0xffff;
        break;
      }
      case 0xb0: { // BCS
        const off = this.fetch8() << 24 >> 24;
        if ((this.state.P & Flag.C) !== 0) this.state.PC = (this.state.PC + off) & 0xffff;
        break;
      }
      case 0x10: { // BPL
        const off = this.fetch8() << 24 >> 24;
        if ((this.state.P & Flag.N) === 0) this.state.PC = (this.state.PC + off) & 0xffff;
        break;
      }
      case 0x30: { // BMI
        const off = this.fetch8() << 24 >> 24;
        if ((this.state.P & Flag.N) !== 0) this.state.PC = (this.state.PC + off) & 0xffff;
        break;
      }
      case 0x80: { // BRA (branch always)
        const off = this.fetch8() << 24 >> 24;
        this.state.PC = (this.state.PC + off) & 0xffff;
        break;
      }
      case 0x50: { // BVC
        const off = this.fetch8() << 24 >> 24;
        if ((this.state.P & Flag.V) === 0) this.state.PC = (this.state.PC + off) & 0xffff;
        break;
      }
      case 0x70: { // BVS
        const off = this.fetch8() << 24 >> 24;
        if ((this.state.P & Flag.V) !== 0) this.state.PC = (this.state.PC + off) & 0xffff;
        break;
      }

      // LDA abs (DBR:addr)
      case 0xad: {
        const addr = this.fetch16();
        if (this.m8) {
          const value = this.read8(this.state.DBR, addr);
          this.state.A = (this.state.A & 0xff00) | value;
          this.setZNFromValue(value, 8);
        } else {
          const value = this.read16(this.state.DBR, addr);
          this.state.A = value;
          this.setZNFromValue(value, 16);
        }
        break;
      }

      case 0xbd: { // LDA abs,X
        const addr = this.fetch16();
        const { bank: effBank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexX());
        if (this.m8) {
          const value = this.read8(effBank, eff);
          this.state.A = (this.state.A & 0xff00) | value;
          this.setZNFromValue(value, 8);
        } else {
          const value = this.read16(effBank, eff);
          this.state.A = value;
          this.setZNFromValue(value, 16);
        }
        break;
      }

      case 0xb9: { // LDA abs,Y
        const addr = this.fetch16();
        const { bank: effBank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexY());
        if (this.m8) {
          const value = this.read8(effBank, eff);
          this.state.A = (this.state.A & 0xff00) | value;
          this.setZNFromValue(value, 8);
        } else {
          const value = this.read16(effBank, eff);
          this.state.A = value;
          this.setZNFromValue(value, 16);
        }
        break;
      }

      // LDA long (absolute long) and long,X
      case 0xaf: { // LDA long
        const lo = this.fetch8();
        const hi = this.fetch8();
        const bank = this.fetch8();
        const addr = ((hi << 8) | lo) & 0xffff;
        if (this.m8) {
          const value = this.read8(bank & 0xff, addr);
          this.state.A = (this.state.A & 0xff00) | value;
          this.setZNFromValue(value, 8);
        } else {
          const value = this.read16Cross(bank & 0xff, addr);
          this.state.A = value;
          this.setZNFromValue(value, 16);
        }
        break;
      }
      case 0xbf: { // LDA long,X
        const lo = this.fetch8();
        const hi = this.fetch8();
        const bank = this.fetch8() & 0xff;
        const base = ((hi << 8) | lo) & 0xffff;
        const sum24 = (bank << 16) | base;
        const indexed24 = (sum24 + this.indexX()) >>> 0;
        const effBank = (indexed24 >>> 16) & 0xff;
        const effAddr = indexed24 & 0xffff;
        if (this.m8) {
          const value = this.read8(effBank, effAddr);
          this.state.A = (this.state.A & 0xff00) | value;
          this.setZNFromValue(value, 8);
        } else {
          const value = this.read16Cross(effBank, effAddr);
          this.state.A = value;
          this.setZNFromValue(value, 16);
        }
        break;
      }

      // STA abs (DBR:addr)
      case 0x8d: {
        const addr = this.fetch16();
        if (this.m8) {
          const value = this.state.A & 0xff;
          this.write8(this.state.DBR, addr, value);
        } else {
          const value = this.state.A & 0xffff;
this.write16Cross(this.state.DBR, addr, value & 0xffff);
        }
        break;
      }

      case 0x9d: { // STA abs,X
        const addr = this.fetch16();
        const { bank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexX());
        if (this.m8) {
          const value = this.state.A & 0xff;
          this.write8(bank, eff, value);
        } else {
          const value = this.state.A & 0xffff;
          this.write16Cross(bank, eff, value & 0xffff);
        }
        break;
      }

      case 0x99: { // STA abs,Y
        const addr = this.fetch16();
        const { bank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexY());
        if (this.m8) {
          const value = this.state.A & 0xff;
          this.write8(bank, eff, value);
        } else {
          const value = this.state.A & 0xffff;
          this.write16Cross(bank, eff, value & 0xffff);
        }
        break;
      }

      // STA long (absolute long) and long,X
      case 0x8f: { // STA long
        const lo = this.fetch8();
        const hi = this.fetch8();
        const bank = this.fetch8() & 0xff;
        const addr = ((hi << 8) | lo) & 0xffff;
        if (this.m8) {
          const value = this.state.A & 0xff;
          this.write8(bank, addr, value);
        } else {
          const value = this.state.A & 0xffff;
          this.write16Cross(bank, addr, value & 0xffff);
        }
        break;
      }
      case 0x9f: { // STA long,X
        const lo = this.fetch8();
        const hi = this.fetch8();
        const bank = this.fetch8() & 0xff;
        const base = ((hi << 8) | lo) & 0xffff;
        const eff = (base + this.indexX()) & 0xffff;
        if (this.m8) {
          const value = this.state.A & 0xff;
          this.write8(bank, eff, value);
        } else {
          const value = this.state.A & 0xffff;
          this.write16Cross(bank, eff, value & 0xffff);
        }
        break;
      }

      // STZ instructions (store zero) - width depends on M (8/16)
      case 0x64: { // STZ dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.m8) {
          this.write8(0x00, eff, 0x00);
        } else {
          // 16-bit store: write low then high within bank 0
          this.write16(0x00, eff, 0x0000);
        }
        break;
      }
      case 0x74: { // STZ dp,X
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, true);
        if (this.m8) {
          this.write8(0x00, eff, 0x00);
        } else {
          this.write16(0x00, eff, 0x0000);
        }
        break;
      }
      case 0x9c: { // STZ abs
        const addr = this.fetch16();
        if (this.m8) {
          this.write8(this.state.DBR, addr, 0x00);
        } else {
this.write16Cross(this.state.DBR, addr, 0x0000);
        }
        break;
      }
      case 0x9e: { // STZ abs,X
        const addr = this.fetch16();
        const { bank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexX());
        if (this.m8) {
          this.write8(bank, eff, 0x00);
        } else {
          this.write16Cross(bank, eff, 0x0000);
        }
        break;
      }

      // Stack operations: PHA/PLA, PHP/PLP, PHK/PLB
      case 0x48: { // PHA
        if (this.m8) {
          const val = this.state.A & 0xff;
          this.push8(val);
        } else {
          // Push 16-bit A: high then low (matches 65C816 stack order for 16-bit pushes)
          const a = this.state.A & 0xffff;
          this.push8((a >>> 8) & 0xff);
          this.push8(a & 0xff);
        }
        break;
      }
      case 0x68: { // PLA
        if (this.m8) {
          const v = this.pull8();
          this.state.A = (this.state.A & 0xff00) | v;
          this.setZNFromValue(v, 8);
        } else {
          const lo = this.pull8();
          const hi = this.pull8();
          const a = ((hi << 8) | lo) & 0xffff;
          this.state.A = a;
          this.setZNFromValue(a, 16);
        }
        break;
      }
      case 0x08: { // PHP
        this.push8(this.state.P);
        break;
      }
      case 0x28: { // PLP
        this.state.P = this.pull8();
        this.updateWidthConstraintsForE();
        this.applyWidthAfterPChange();
        break;
      }
      case 0x4b: { // PHK
        this.push8(this.state.PBR);
        break;
      }
      case 0x8b: { // PHB (push DBR)
        this.push8(this.state.DBR);
        break;
      }
      case 0xab: { // PLB
        this.state.DBR = this.pull8();
        break;
      }
      case 0x0b: { // PHD (push D)
        const d = this.state.D & 0xffff;
        // Push high then low for 16-bit
        this.push8((d >>> 8) & 0xff);
        this.push8(d & 0xff);
        break;
      }
      case 0x2b: { // PLD (pull D)
        const lo = this.pull8();
        const hi = this.pull8();
        const d = ((hi << 8) | lo) & 0xffff;
        this.state.D = d;
        this.setZNFromValue(d, 16);
        break;
      }
      case 0xda: { // PHX
        if (this.x8) {
          const v = this.state.X & 0xff;
          this.push8(v);
        } else {
          const x = this.state.X & 0xffff;
          // Push high then low for 16-bit
          this.push8((x >>> 8) & 0xff);
          this.push8(x & 0xff);
        }
        break;
      }
      case 0xfa: { // PLX
        if (this.x8) {
          const v = this.pull8();
          this.state.X = (this.state.X & 0xff00) | v;
          this.setZNFromValue(v, 8);
        } else {
          const lo = this.pull8();
          const hi = this.pull8();
          const x = ((hi << 8) | lo) & 0xffff;
          this.state.X = x;
          this.setZNFromValue(x, 16);
        }
        break;
      }
      case 0x5a: { // PHY
        if (this.x8) {
          const v = this.state.Y & 0xff;
          this.push8(v);
        } else {
          const y = this.state.Y & 0xffff;
          // Push high then low for 16-bit
          this.push8((y >>> 8) & 0xff);
          this.push8(y & 0xff);
        }
        break;
      }
      case 0x7a: { // PLY
        if (this.x8) {
          const v = this.pull8();
          this.state.Y = (this.state.Y & 0xff00) | v;
          this.setZNFromValue(v, 8);
        } else {
          const lo = this.pull8();
          const hi = this.pull8();
          const y = ((hi << 8) | lo) & 0xffff;
          this.state.Y = y;
          this.setZNFromValue(y, 16);
        }
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
      case 0xfc: { // JSR (abs,X)
        const base = this.fetch16();
        const eff = (base + this.indexX()) & 0xffff;
        const lo = this.read8(this.state.PBR, eff);
        const hi = this.read8(this.state.PBR, (eff + 1) & 0xffff);
        const target = ((hi << 8) | lo) & 0xffff;
        const ret = (this.state.PC - 1) & 0xffff;
        this.push8((ret >>> 8) & 0xff);
        this.push8(ret & 0xff);
        this.state.PC = target;
        break;
      }
      case 0x22: { // JSL long absolute
        const targetLo = this.fetch8();
        const targetHi = this.fetch8();
        const targetBank = this.fetch8();
        // Push return: PBR then PC-1 (high, low)
        const ret = (this.state.PC - 1) & 0xffff;
        this.push8(this.state.PBR);
        this.push8((ret >>> 8) & 0xff);
        this.push8(ret & 0xff);
        this.state.PBR = targetBank & 0xff;
        this.state.PC = ((targetHi << 8) | targetLo) & 0xffff;
        break;
      }
      case 0x4c: { // JMP abs
        const target = this.fetch16();
        this.state.PC = target;
        break;
      }
      case 0x6c: { // JMP (abs)
        const ptr = this.fetch16();
        const lo = this.read8(this.state.PBR, ptr);
        const hi = this.read8(this.state.PBR, (ptr + 1) & 0xffff);
        this.state.PC = ((hi << 8) | lo) & 0xffff;
        break;
      }
      case 0x7c: { // JMP (abs,X)
        const base = this.fetch16();
        const eff = (base + this.indexX()) & 0xffff;
        const lo = this.read8(this.state.PBR, eff);
        const hi = this.read8(this.state.PBR, (eff + 1) & 0xffff);
        this.state.PC = ((hi << 8) | lo) & 0xffff;
        break;
      }
      case 0x6b: { // RTL
        const lo = this.pull8();
        const hi = this.pull8();
        const bank = this.pull8();
        this.state.PBR = bank & 0xff;
        const addr = ((hi << 8) | lo) & 0xffff;
        this.state.PC = (addr + 1) & 0xffff;
        break;
      }
      case 0x5c: { // JML long absolute (jump, not subroutine)
        const targetLo = this.fetch8();
        const targetHi = this.fetch8();
        const targetBank = this.fetch8();
        this.state.PBR = targetBank & 0xff;
        this.state.PC = ((targetHi << 8) | targetLo) & 0xffff;
        break;
      }
      case 0xdc: { // JML [abs] (absolute indirect long)
        const ptr = this.fetch16();
        const lo = this.read8(0x00, ptr);
        const hi = this.read8(0x00, (ptr + 1) & 0xffff);
        const bank = this.read8(0x00, (ptr + 2) & 0xffff) & 0xff;
        this.state.PBR = bank;
        this.state.PC = ((hi << 8) | lo) & 0xffff;
        break;
      }
      case 0x60: { // RTS
        const lo = this.pull8();
        const hi = this.pull8();
        const addr = ((hi << 8) | lo) & 0xffff;
        this.state.PC = (addr + 1) & 0xffff;
        break;
      }

      // AND (with M width)
      case 0x29: { // AND #imm
        if (this.m8) {
          const imm = this.fetch8();
          const res = (this.state.A & 0xff) & imm;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const imm = this.fetch16();
          const res = (this.state.A & 0xffff) & imm;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x25: { // AND dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.m8) {
          const m = this.read8(0x00, eff);
          const res = (this.state.A & 0xff) & m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = ((hi << 8) | lo) & 0xffff;
          const res = (this.state.A & 0xffff) & m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x35: { // AND dp,X
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, true);
        if (this.m8) {
          const m = this.read8(0x00, eff);
          const res = (this.state.A & 0xff) & m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = ((hi << 8) | lo) & 0xffff;
          const res = (this.state.A & 0xffff) & m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x2d: { // AND abs
        const addr = this.fetch16();
        if (this.m8) {
          const m = this.read8(this.state.DBR, addr);
          const res = (this.state.A & 0xff) & m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
const m = this.read16(this.state.DBR, addr);
          const res = (this.state.A & 0xffff) & m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x3d: { // AND abs,X
        const addr = this.fetch16();
        const { bank: effBank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexX());
        if (this.m8) {
          const m = this.read8(effBank, eff);
          const res = (this.state.A & 0xff) & m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(effBank, eff);
          const res = (this.state.A & 0xffff) & m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x39: { // AND abs,Y
        const addr = this.fetch16();
        const { bank: effBank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexY());
        if (this.m8) {
          const m = this.read8(effBank, eff);
          const res = (this.state.A & 0xff) & m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(effBank, eff);
          const res = (this.state.A & 0xffff) & m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x21: { // AND (dp,X)
        const dp = this.fetch8();
        const off = (((dp & 0xff) + (this.state.X & 0xff)) & 0xff);
        const eff = this.dpPtr16(off);
        if (this.m8) {
          const m = this.read8(this.state.DBR, eff);
          const res = (this.state.A & 0xff) & m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(this.state.DBR, eff);
          const res = (this.state.A & 0xffff) & m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x32: { // AND (dp)
        const dp = this.fetch8();
        const eff = this.dpPtr16(dp);
        if (this.m8) {
          const m = this.read8(this.state.DBR, eff);
          const res = (this.state.A & 0xff) & m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(this.state.DBR, eff);
          const res = (this.state.A & 0xffff) & m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x23: { // AND sr
        const sr = this.fetch8();
        const base = this.srBase();
        const eff = (base + (sr & 0xff)) & 0xffff;
        if (this.m8) {
          const m = this.read8(0x00, eff as Word);
          const res = (this.state.A & 0xff) & m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const lo = this.read8(0x00, eff as Word);
          const hi = this.read8(0x00, ((eff + 1) & 0xffff) as Word);
          const m = ((hi << 8) | lo) & 0xffff;
          const res = (this.state.A & 0xffff) & m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x31: { // AND (dp),Y
        const dp = this.fetch8();
        const { bank, addr } = this.effIndDPY(dp);
        if (this.m8) {
          const m = this.read8(bank, addr);
          const res = (this.state.A & 0xff) & m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(bank, addr);
          const res = (this.state.A & 0xffff) & m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x33: { // AND (sr),Y
        const sr = this.fetch8();
        const { bank, addr } = this.effSRY(sr);
        if (this.m8) {
          const m = this.read8(bank, addr);
          const res = (this.state.A & 0xff) & m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(bank, addr);
          const res = (this.state.A & 0xffff) & m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x2f: { // AND long
        const lo = this.fetch8();
        const hi = this.fetch8();
        const bank = this.fetch8() & 0xff;
        const addr = ((hi << 8) | lo) & 0xffff;
        if (this.m8) {
          const m = this.read8(bank, addr);
          const res = (this.state.A & 0xff) & m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16Cross(bank, addr);
          const res = (this.state.A & 0xffff) & m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x3f: { // AND long,X
        const lo = this.fetch8();
        const hi = this.fetch8();
        const bank = this.fetch8() & 0xff;
        const base = ((hi << 8) | lo) & 0xffff;
        const sum24 = (bank << 16) | base;
        const indexed24 = (sum24 + this.indexX()) >>> 0;
        const effBank = (indexed24 >>> 16) & 0xff;
        const effAddr = indexed24 & 0xffff;
        if (this.m8) {
          const m = this.read8(effBank, effAddr);
          const res = (this.state.A & 0xff) & m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16Cross(effBank, effAddr);
          const res = (this.state.A & 0xffff) & m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x27: { // AND [dp]
        const dp = this.fetch8();
        const { bank, addr } = this.dpPtrLong(dp);
        if (this.m8) {
          const m = this.read8(bank, addr);
          const res = (this.state.A & 0xff) & m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16Cross(bank, addr);
          const res = (this.state.A & 0xffff) & m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x37: { // AND [dp],Y
        const dp = this.fetch8();
        const { bank, addr } = this.effLongDPY(dp);
        if (this.m8) {
          const m = this.read8(bank, addr);
          const res = (this.state.A & 0xff) & m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16Cross(bank, addr);
          const res = (this.state.A & 0xffff) & m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }

      // ORA
      case 0x09: { // ORA #imm
        if (this.m8) {
          const imm = this.fetch8();
          const res = (this.state.A & 0xff) | imm;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const imm = this.fetch16();
          const res = (this.state.A & 0xffff) | imm;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x05: { // ORA dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.m8) {
          const m = this.read8(0x00, eff);
          const res = (this.state.A & 0xff) | m;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = ((hi << 8) | lo) & 0xffff;
          const res = (this.state.A & 0xffff) | m;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x15: { // ORA dp,X
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, true);
        if (this.m8) {
          const m = this.read8(0x00, eff);
          const res = (this.state.A & 0xff) | m;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = ((hi << 8) | lo) & 0xffff;
          const res = (this.state.A & 0xffff) | m;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x0d: { // ORA abs
        const addr = this.fetch16();
        if (this.m8) {
          const m = this.read8(this.state.DBR, addr);
          const res = (this.state.A & 0xff) | m;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(this.state.DBR, addr);
          const res = (this.state.A & 0xffff) | m;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x1d: { // ORA abs,X
        const addr = this.fetch16();
        const { bank: effBank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexX());
        if (this.m8) {
          const m = this.read8(effBank, eff);
          const res = (this.state.A & 0xff) | m;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(effBank, eff);
          const res = (this.state.A & 0xffff) | m;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x19: { // ORA abs,Y
        const addr = this.fetch16();
        const { bank: effBank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexY());
        if (this.m8) {
          const m = this.read8(effBank, eff);
          const res = (this.state.A & 0xff) | m;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(effBank, eff);
          const res = (this.state.A & 0xffff) | m;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x01: { // ORA (dp,X)
        const dp = this.fetch8();
        const off = (((dp & 0xff) + (this.state.X & 0xff)) & 0xff);
        const eff = this.dpPtr16(off);
        if (this.m8) {
          const m = this.read8(this.state.DBR, eff);
          const res = (this.state.A & 0xff) | m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(this.state.DBR, eff);
          const res = (this.state.A & 0xffff) | m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x12: { // ORA (dp)
        const dp = this.fetch8();
        const eff = this.dpPtr16(dp);
        if (this.m8) {
          const m = this.read8(this.state.DBR, eff);
          const res = (this.state.A & 0xff) | m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(this.state.DBR, eff);
          const res = (this.state.A & 0xffff) | m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x03: { // ORA sr
        const sr = this.fetch8();
        const base = this.state.E ? (((this.state.S & 0xff) + sr) & 0xff | 0x0100) : ((this.state.S + sr) & 0xffff);
        if (this.m8) {
          const m = this.read8(0x00, base as Word);
          const res = (this.state.A & 0xff) | m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const lo = this.read8(0x00, base as Word);
          const hi = this.read8(0x00, ((base + 1) & 0xffff) as Word);
          const m = ((hi << 8) | lo) & 0xffff;
          const res = (this.state.A & 0xffff) | m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x11: { // ORA (dp),Y
        const dp = this.fetch8();
        const { bank, addr } = this.effIndDPY(dp);
        if (this.m8) {
          const m = this.read8(bank, addr);
          const res = (this.state.A & 0xff) | m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
const m = this.read16(bank, addr);
          const res = (this.state.A & 0xffff) | m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x13: { // ORA (sr),Y
        const sr = this.fetch8();
        const { bank, addr } = this.effSRY(sr);
        if (this.m8) {
          const m = this.read8(bank, addr);
          const res = (this.state.A & 0xff) | m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(bank, addr);
          const res = (this.state.A & 0xffff) | m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x0f: { // ORA long
        const lo = this.fetch8();
        const hi = this.fetch8();
        const bank = this.fetch8() & 0xff;
        const addr = ((hi << 8) | lo) & 0xffff;
        if (this.m8) {
          const m = this.read8(bank, addr);
          const res = (this.state.A & 0xff) | m;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16Cross(bank, addr);
          const res = (this.state.A & 0xffff) | m;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x1f: { // ORA long,X
        const lo = this.fetch8();
        const hi = this.fetch8();
        const bank = this.fetch8() & 0xff;
        const base = ((hi << 8) | lo) & 0xffff;
        const sum24 = (bank << 16) | base;
        const indexed24 = (sum24 + this.indexX()) >>> 0;
        const effBank = (indexed24 >>> 16) & 0xff;
        const effAddr = indexed24 & 0xffff;
        if (this.m8) {
          const m = this.read8(effBank, effAddr);
          const res = (this.state.A & 0xff) | m;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16Cross(effBank, effAddr);
          const res = (this.state.A & 0xffff) | m;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x07: { // ORA [dp]
        const dp = this.fetch8();
        const ptr = (this.state.D + dp) & 0xffff;
        const lo = this.read8(0x00, ptr);
        const hi = this.read8(0x00, (ptr + 1) & 0xffff);
        const bank = this.read8(0x00, (ptr + 2) & 0xffff) & 0xff;
        const addr = ((hi << 8) | lo) & 0xffff;
        if (this.m8) {
          const m = this.read8(bank, addr);
          const res = (this.state.A & 0xff) | m;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16Cross(bank, addr);
          const res = (this.state.A & 0xffff) | m;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x17: { // ORA [dp],Y
        const dp = this.fetch8();
        const { bank, addr } = this.effLongDPY(dp);
        if (this.m8) {
          const m = this.read8(bank, addr);
          const res = (this.state.A & 0xff) | m;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16Cross(bank, addr);
          const res = (this.state.A & 0xffff) | m;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }

      // EOR
      case 0x49: { // EOR #imm
        if (this.m8) {
          const imm = this.fetch8();
          const res = (this.state.A & 0xff) ^ imm;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const imm = this.fetch16();
          const res = (this.state.A & 0xffff) ^ imm;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x45: { // EOR dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.m8) {
          const m = this.read8(0x00, eff);
          const res = (this.state.A & 0xff) ^ m;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = ((hi << 8) | lo) & 0xffff;
          const res = (this.state.A & 0xffff) ^ m;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x55: { // EOR dp,X
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, true);
        if (this.m8) {
          const m = this.read8(0x00, eff);
          const res = (this.state.A & 0xff) ^ m;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const m = ((hi << 8) | lo) & 0xffff;
          const res = (this.state.A & 0xffff) ^ m;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x5d: { // EOR abs,X
        const addr = this.fetch16();
        const { bank: effBank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexX());
        if (this.m8) {
          const m = this.read8(effBank, eff);
          const res = (this.state.A & 0xff) ^ m;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(effBank, eff);
          const res = (this.state.A & 0xffff) ^ m;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x59: { // EOR abs,Y
        const addr = this.fetch16();
        const { bank: effBank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexY());
        if (this.m8) {
          const m = this.read8(effBank, eff);
          const res = (this.state.A & 0xff) ^ m;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(effBank, eff);
          const res = (this.state.A & 0xffff) ^ m;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x41: { // EOR (dp,X)
        const dp = this.fetch8();
        const off = (((dp & 0xff) + (this.state.X & 0xff)) & 0xff);
        const eff = this.dpPtr16(off);
        if (this.m8) {
          const m = this.read8(this.state.DBR, eff);
          const res = (this.state.A & 0xff) ^ m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(this.state.DBR, eff);
          const res = (this.state.A & 0xffff) ^ m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x52: { // EOR (dp)
        const dp = this.fetch8();
        const eff = this.dpPtr16(dp);
        if (this.m8) {
          const m = this.read8(this.state.DBR, eff);
          const res = (this.state.A & 0xff) ^ m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(this.state.DBR, eff);
          const res = (this.state.A & 0xffff) ^ m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x4d: { // EOR abs
        const addr = this.fetch16();
        if (this.m8) {
          const m = this.read8(this.state.DBR, addr);
          const res = (this.state.A & 0xff) ^ m;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(this.state.DBR, addr);
          const res = (this.state.A & 0xffff) ^ m;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x43: { // EOR sr
        const sr = this.fetch8();
        const base = this.srBase();
        const eff = (base + (sr & 0xff)) & 0xffff;
        if (this.m8) {
          const m = this.read8(0x00, eff as Word);
          const res = (this.state.A & 0xff) ^ m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const lo = this.read8(0x00, eff as Word);
          const hi = this.read8(0x00, ((eff + 1) & 0xffff) as Word);
          const m = ((hi << 8) | lo) & 0xffff;
          const res = (this.state.A & 0xffff) ^ m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x51: { // EOR (dp),Y
        const dp = this.fetch8();
        const { bank, addr } = this.effIndDPY(dp);
        if (this.m8) {
          const m = this.read8(bank, addr);
          const res = (this.state.A & 0xff) ^ m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(bank, addr);
          const res = (this.state.A & 0xffff) ^ m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x53: { // EOR (sr),Y
        const sr = this.fetch8();
        const { bank, addr } = this.effSRY(sr);
        if (this.m8) {
          const m = this.read8(bank, addr);
          const res = (this.state.A & 0xff) ^ m;
          this.state.A = (this.state.A & 0xff00) | res;
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16(bank, addr);
          const res = (this.state.A & 0xffff) ^ m;
          this.state.A = res;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x4f: { // EOR long
        const lo = this.fetch8();
        const hi = this.fetch8();
        const bank = this.fetch8() & 0xff;
        const addr = ((hi << 8) | lo) & 0xffff;
        if (this.m8) {
          const m = this.read8(bank, addr);
          const res = (this.state.A & 0xff) ^ m;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16Cross(bank, addr);
          const res = (this.state.A & 0xffff) ^ m;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x5f: { // EOR long,X
        const lo = this.fetch8();
        const hi = this.fetch8();
        const bank = this.fetch8() & 0xff;
        const base = ((hi << 8) | lo) & 0xffff;
        const sum24 = (bank << 16) | base;
        const indexed24 = (sum24 + this.indexX()) >>> 0;
        const effBank = (indexed24 >>> 16) & 0xff;
        const effAddr = indexed24 & 0xffff;
        if (this.m8) {
          const m = this.read8(effBank, effAddr);
          const res = (this.state.A & 0xff) ^ m;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16Cross(effBank, effAddr);
          const res = (this.state.A & 0xffff) ^ m;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x47: { // EOR [dp]
        const dp = this.fetch8();
        const { bank, addr } = this.dpPtrLong(dp);
        if (this.m8) {
          const m = this.read8(bank, addr);
          const res = (this.state.A & 0xff) ^ m;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16Cross(bank, addr);
          const res = (this.state.A & 0xffff) ^ m;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }
      case 0x57: { // EOR [dp],Y
        const dp = this.fetch8();
        const { bank, addr } = this.effLongDPY(dp);
        if (this.m8) {
          const m = this.read8(bank, addr);
          const res = (this.state.A & 0xff) ^ m;
          this.state.A = (this.state.A & 0xff00) | (res & 0xff);
          this.setZNFromValue(res, 8);
        } else {
          const m = this.read16Cross(bank, addr);
          const res = (this.state.A & 0xffff) ^ m;
          this.state.A = res & 0xffff;
          this.setZNFromValue(res, 16);
        }
        break;
      }

      // INX/DEX/INY/DEY (width depends on X flag)
      case 0xe8: { // INX
        if (this.x8) {
          const x = (this.state.X + 1) & 0xff;
          this.state.X = (this.state.X & 0xff00) | x;
          this.setZNFromValue(x, 8);
        } else {
          const x = (this.state.X + 1) & 0xffff;
          this.state.X = x;
          this.setZNFromValue(x, 16);
        }
        break;
      }
      case 0xca: { // DEX
        if (this.x8) {
          const x = (this.state.X - 1) & 0xff;
          this.state.X = (this.state.X & 0xff00) | x;
          this.setZNFromValue(x, 8);
        } else {
          const x = (this.state.X - 1) & 0xffff;
          this.state.X = x;
          this.setZNFromValue(x, 16);
        }
        break;
      }
      case 0xc8: { // INY
        if (this.x8) {
          const y = (this.state.Y + 1) & 0xff;
          this.state.Y = (this.state.Y & 0xff00) | y;
          this.setZNFromValue(y, 8);
        } else {
          const y = (this.state.Y + 1) & 0xffff;
          this.state.Y = y;
          this.setZNFromValue(y, 16);
        }
        break;
      }
      case 0x88: { // DEY
        if (this.x8) {
          const y = (this.state.Y - 1) & 0xff;
          this.state.Y = (this.state.Y & 0xff00) | y;
          this.setZNFromValue(y, 8);
        } else {
          const y = (this.state.Y - 1) & 0xffff;
          this.state.Y = y;
          this.setZNFromValue(y, 16);
        }
        break;
      }

      // Transfers TAX/TAY/TXA/TYA, TSX/TXS (width-aware in native mode)
      case 0xaa: { // TAX
        if (this.x8) {
          const v8 = this.state.A & 0xff; // source is A low
          this.state.X = v8 & 0xff; // X high forced 0 in 8-bit mode
          this.setZNFromValue(v8, 8);
        } else {
          // When X is 16-bit, transfer full 16 bits of A regardless of M
          const v16 = this.state.A & 0xffff;
          this.state.X = v16;
          this.setZNFromValue(v16, 16);
        }
        break;
      }
      case 0xa8: { // TAY
        if (this.x8) {
          const v8 = this.state.A & 0xff;
          this.state.Y = v8 & 0xff;
          this.setZNFromValue(v8, 8);
        } else {
          // When Y is 16-bit, transfer full 16 bits of A regardless of M
          const v16 = this.state.A & 0xffff;
          this.state.Y = v16;
          this.setZNFromValue(v16, 16);
        }
        break;
      }
      case 0x8a: { // TXA
        if (this.m8) {
          const v8 = this.state.X & 0xff; // source X low
          this.state.A = (this.state.A & 0xff00) | v8; // only low A changes in 8-bit mode
          this.setZNFromValue(v8, 8);
        } else {
          const v16 = this.x8 ? (this.state.X & 0xff) : (this.state.X & 0xffff);
          this.state.A = v16 & 0xffff; // zero-extend if X is 8-bit
          this.setZNFromValue(v16, 16);
        }
        break;
      }
      case 0x98: { // TYA
        if (this.m8) {
          const v8 = this.state.Y & 0xff;
          this.state.A = (this.state.A & 0xff00) | v8;
          this.setZNFromValue(v8, 8);
        } else {
          const v16 = this.x8 ? (this.state.Y & 0xff) : (this.state.Y & 0xffff);
          this.state.A = v16 & 0xffff;
          this.setZNFromValue(v16, 16);
        }
        break;
      }
      case 0xba: { // TSX
        if (this.x8) {
          const v8 = this.state.S & 0xff;
          this.state.X = v8 & 0xff;
          this.setZNFromValue(v8, 8);
        } else {
          const v16 = this.state.S & 0xffff;
          this.state.X = v16;
          this.setZNFromValue(v16, 16);
        }
        break;
      }
      case 0x9a: { // TXS
        if (this.state.E) {
          const v8 = this.state.X & 0xff;
          this.state.S = (0x0100 | v8) & 0xffff;
        } else {
          if (this.x8) {
            const v8 = this.state.X & 0xff;
            this.state.S = (this.state.S & 0xff00) | v8; // only low byte updated in 8-bit index mode
          } else {
            const v16 = this.state.X & 0xffff;
            this.state.S = v16;
          }
        }
        break;
      }
      case 0x1b: { // TCS (A -> S)
        if (this.m8) {
          const lo = this.state.A & 0xff;
          if (this.state.E) this.state.S = (0x0100 | lo) & 0xffff; else this.state.S = (this.state.S & 0xff00) | lo;
        } else {
          this.state.S = this.state.A & 0xffff;
        }
        if (this.state.E) this.state.S = (this.state.S & 0xff) | 0x0100;
        break;
      }
      case 0x3b: { // TSC (S -> A)
        const s = this.state.S & 0xffff;
        if (this.m8) {
          const lo = s & 0xff;
          this.state.A = (this.state.A & 0xff00) | lo;
          this.setZNFromValue(lo, 8);
        } else {
          this.state.A = s;
          this.setZNFromValue(s, 16);
        }
        break;
      }
      case 0x5b: { // TCD (A -> D)
        const a16 = this.m8 ? (this.state.A & 0xff) : (this.state.A & 0xffff);
        this.state.D = a16 & 0xffff;
        // Set ZN based on 16-bit result (D is 16-bit)
        this.setZNFromValue(this.state.D, 16);
        break;
      }
      case 0x7b: { // TDC (D -> A)
        const d = this.state.D & 0xffff;
        if (this.m8) {
          const lo = d & 0xff;
          this.state.A = (this.state.A & 0xff00) | lo;
          this.setZNFromValue(lo, 8);
        } else {
          this.state.A = d;
          this.setZNFromValue(d, 16);
        }
        break;
      }
      case 0x9b: { // TXY
        if (this.x8) {
          const v = this.state.X & 0xff;
          this.state.Y = (this.state.Y & 0xff00) | v;
          this.setZNFromValue(v, 8);
        } else {
          const v = this.state.X & 0xffff;
          this.state.Y = v;
          this.setZNFromValue(v, 16);
        }
        break;
      }
      case 0xbb: { // TYX
        if (this.x8) {
          const v = this.state.Y & 0xff;
          this.state.X = (this.state.X & 0xff00) | v;
          this.setZNFromValue(v, 8);
        } else {
          const v = this.state.Y & 0xffff;
          this.state.X = v;
          this.setZNFromValue(v, 16);
        }
        break;
      }

      // LDX/LDY memory and STX/STY (respect X width for X/Y)
      case 0xa6: { // LDX dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.x8) {
          const v = this.read8(0x00, eff);
          this.state.X = (this.state.X & 0xff00) | v;
          this.setZNFromValue(v, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const v = ((hi << 8) | lo) & 0xffff;
          this.state.X = v;
          this.setZNFromValue(v, 16);
        }
        break;
      }
      case 0xb6: { // LDX dp,Y
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, false);
        if (this.x8) {
          const v = this.read8(0x00, eff);
          this.state.X = (this.state.X & 0xff00) | v;
          this.setZNFromValue(v, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const v = ((hi << 8) | lo) & 0xffff;
          this.state.X = v;
          this.setZNFromValue(v, 16);
        }
        break;
      }
      case 0xae: { // LDX abs
        const addr = this.fetch16();
        if (this.x8) {
          const v = this.read8(this.state.DBR, addr);
          this.state.X = (this.state.X & 0xff00) | v;
          this.setZNFromValue(v, 8);
        } else {
const v = this.read16(this.state.DBR, addr);
          this.state.X = v;
          this.setZNFromValue(v, 16);
        }
        break;
      }
      case 0xbe: { // LDX abs,Y
        const addr = this.fetch16();
        const { bank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexY());
        if (this.x8) {
          const v = this.read8(bank, eff);
          this.state.X = (this.state.X & 0xff00) | v;
          this.setZNFromValue(v, 8);
        } else {
          const v = this.read16(bank, eff);
          this.state.X = v;
          this.setZNFromValue(v, 16);
        }
        break;
      }
      case 0xa4: { // LDY dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.x8) {
          const v = this.read8(0x00, eff);
          this.state.Y = (this.state.Y & 0xff00) | v;
          this.setZNFromValue(v, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const v = ((hi << 8) | lo) & 0xffff;
          this.state.Y = v;
          this.setZNFromValue(v, 16);
        }
        break;
      }
      case 0xb4: { // LDY dp,X
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, true);
        if (this.x8) {
          const v = this.read8(0x00, eff);
          this.state.Y = (this.state.Y & 0xff00) | v;
          this.setZNFromValue(v, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const v = ((hi << 8) | lo) & 0xffff;
          this.state.Y = v;
          this.setZNFromValue(v, 16);
        }
        break;
      }
      case 0xac: { // LDY abs
        const addr = this.fetch16();
        if (this.x8) {
          const v = this.read8(this.state.DBR, addr);
          this.state.Y = (this.state.Y & 0xff00) | v;
          this.setZNFromValue(v, 8);
        } else {
          const v = this.read16(this.state.DBR, addr);
          this.state.Y = v;
          this.setZNFromValue(v, 16);
        }
        break;
      }
      case 0xbc: { // LDY abs,X
        const addr = this.fetch16();
        const { bank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexX());
        if (this.x8) {
          const v = this.read8(bank, eff);
          this.state.Y = (this.state.Y & 0xff00) | v;
          this.setZNFromValue(v, 8);
        } else {
          const v = this.read16(bank, eff);
          this.state.Y = v;
          this.setZNFromValue(v, 16);
        }
        break;
      }
      case 0x86: { // STX dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        const v = this.x8 ? (this.state.X & 0xff) : (this.state.X & 0xffff);
        this.write8(0x00, eff, v & 0xff);
        if (!this.x8) this.write8(0x00, (eff + 1) & 0xffff, (v >>> 8) & 0xff);
        break;
      }
      case 0x8e: { // STX abs
        const addr = this.fetch16();
        const v = this.x8 ? (this.state.X & 0xff) : (this.state.X & 0xffff);
        if (this.x8) {
          this.write8(this.state.DBR, addr, v & 0xff);
        } else {
          this.write16Cross(this.state.DBR, addr, v & 0xffff);
        }
        break;
      }
      case 0x96: { // STX dp,Y
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, false);
        const v = this.x8 ? (this.state.X & 0xff) : (this.state.X & 0xffff);
        this.write8(0x00, eff, v & 0xff);
        if (!this.x8) this.write8(0x00, (eff + 1) & 0xffff, (v >>> 8) & 0xff);
        break;
      }
      case 0x84: { // STY dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        const v = this.x8 ? (this.state.Y & 0xff) : (this.state.Y & 0xffff);
        this.write8(0x00, eff, v & 0xff);
        if (!this.x8) this.write8(0x00, (eff + 1) & 0xffff, (v >>> 8) & 0xff);
        break;
      }
      case 0x8c: { // STY abs
        const addr = this.fetch16();
        const v = this.x8 ? (this.state.Y & 0xff) : (this.state.Y & 0xffff);
        if (this.x8) {
          this.write8(this.state.DBR, addr, v & 0xff);
        } else {
          this.write16Cross(this.state.DBR, addr, v & 0xffff);
        }
        break;
      }
      case 0x94: { // STY dp,X
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, true);
        const v = this.x8 ? (this.state.Y & 0xff) : (this.state.Y & 0xffff);
        this.write8(0x00, eff, v & 0xff);
        if (!this.x8) this.write8(0x00, (eff + 1) & 0xffff, (v >>> 8) & 0xff);
        break;
      }

      // Direct page LDA/STA (D + dp, bank 0)
      case 0xa5: { // LDA dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.m8) {
          const value = this.read8(0x00, eff);
          this.state.A = (this.state.A & 0xff00) | value;
          this.setZNFromValue(value, 8);
        } else {
          const value = this.read16(0x00, eff);
          this.state.A = value;
          this.setZNFromValue(value, 16);
        }
        break;
      }
      case 0xb5: { // LDA dp,X
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, true);
        if (this.m8) {
          const value = this.read8(0x00, eff);
          this.state.A = (this.state.A & 0xff00) | value;
          this.setZNFromValue(value, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const value = ((hi << 8) | lo) & 0xffff;
          this.state.A = value;
          this.setZNFromValue(value, 16);
        }
        break;
      }
      case 0x85: { // STA dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.m8) {
          const value = this.state.A & 0xff;
          this.write8(0x00, eff, value);
        } else {
          const value = this.state.A & 0xffff;
          this.write16(0x00, eff, value & 0xffff);
        }
        break;
      }
      case 0x95: { // STA dp,X
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, true);
        if (this.m8) {
          const value = this.state.A & 0xff;
          this.write8(0x00, eff, value);
        } else {
          const value = this.state.A & 0xffff;
          this.write8(0x00, eff, value & 0xff);
          this.write8(0x00, (eff + 1) & 0xffff, (value >>> 8) & 0xff);
        }
        break;
      }

      // Indexed indirect, indirect indexed, and long indirect forms
      case 0xa1: { // LDA (dp,X)
        const dp = this.fetch8();
        const off = (((dp & 0xff) + (this.state.X & 0xff)) & 0xff);
        const eff = this.dpPtr16(off);
        if (this.m8) {
          const value = this.read8(this.state.DBR, eff);
          this.state.A = (this.state.A & 0xff00) | value;
          this.setZNFromValue(value, 8);
        } else {
          const value = this.read16(this.state.DBR, eff);
          this.state.A = value;
          this.setZNFromValue(value, 16);
        }
        break;
      }
      case 0xb1: { // LDA (dp),Y
        const dp = this.fetch8();
        const { bank, addr } = this.effIndDPY(dp);
        if (this.m8) {
          const value = this.read8(bank, addr);
          this.state.A = (this.state.A & 0xff00) | value;
          this.setZNFromValue(value, 8);
        } else {
          const value = this.read16(bank, addr);
          this.state.A = value;
          this.setZNFromValue(value, 16);
        }
        break;
      }
      case 0xb2: { // LDA (dp)
        const dp = this.fetch8();
        const { bank, addr } = this.effIndDP(dp);
        if (this.m8) {
          const value = this.read8(bank, addr);
          this.state.A = (this.state.A & 0xff00) | value;
          this.setZNFromValue(value, 8);
        } else {
          const value = this.read16(bank, addr);
          this.state.A = value;
          this.setZNFromValue(value, 16);
        }
        break;
      }
      case 0xb3: { // LDA (sr),Y
        const sr = this.fetch8();
        const { bank, addr } = this.effSRY(sr);
        if (this.m8) {
          const value = this.read8(bank, addr);
          this.state.A = (this.state.A & 0xff00) | value;
          this.setZNFromValue(value, 8);
        } else {
          const value = this.read16(bank, addr);
          this.state.A = value;
          this.setZNFromValue(value, 16);
        }
        break;
      }
      case 0xa3: { // LDA sr (stack-relative)
        const sr = this.fetch8();
        const base = this.srBase();
        const eff = (base + (sr & 0xff)) & 0xffff;
        if (this.m8) {
          const value = this.read8(0x00, eff);
          this.state.A = (this.state.A & 0xff00) | value;
          this.setZNFromValue(value, 8);
        } else {
          const value = this.read16(0x00, eff);
          this.state.A = value;
          this.setZNFromValue(value, 16);
        }
        break;
      }
      case 0xa7: { // LDA [dp] (direct page indirect long)
        const dp = this.fetch8();
        const ptr = (this.state.D + dp) & 0xffff;
        const lo = this.read8(0x00, ptr);
        const hi = this.read8(0x00, (ptr + 1) & 0xffff);
        const bank = this.read8(0x00, (ptr + 2) & 0xffff) & 0xff;
        const addr = ((hi << 8) | lo) & 0xffff;
        if (this.m8) {
          const value = this.read8(bank, addr);
          this.state.A = (this.state.A & 0xff00) | value;
          this.setZNFromValue(value, 8);
        } else {
          const value = this.read16Cross(bank, addr);
          this.state.A = value;
          this.setZNFromValue(value, 16);
        }
        break;
      }
      case 0xb7: { // LDA [dp],Y (direct page indirect long indexed by Y)
        const dp = this.fetch8();
        const { bank, addr } = this.effLongDPY(dp);
        if (this.m8) {
          const value = this.read8(bank, addr);
          this.state.A = (this.state.A & 0xff00) | value;
          this.setZNFromValue(value, 8);
        } else {
          const value = this.read16Cross(bank, addr);
          this.state.A = value;
          this.setZNFromValue(value, 16);
        }
        break;
      }
      case 0x81: { // STA (dp,X)
        const dp = this.fetch8();
        const off = (((dp & 0xff) + (this.state.X & 0xff)) & 0xff);
        const eff = this.dpPtr16(off);
        if (this.m8) {
          const value = this.state.A & 0xff;
          this.write8(this.state.DBR, eff, value);
        } else {
          const value = this.state.A & 0xffff;
          this.write16Cross(this.state.DBR, eff, value & 0xffff);
        }
        break;
      }
      case 0x91: { // STA (dp),Y
        const dp = this.fetch8();
        const { bank, addr } = this.effIndDPY(dp);
        if (this.m8) {
          const value = this.state.A & 0xff;
          this.write8(bank, addr, value);
        } else {
          const value = this.state.A & 0xffff;
          this.write16Cross(bank, addr, value & 0xffff);
        }
        break;
      }
      case 0x92: { // STA (dp)
        const dp = this.fetch8();
        const { bank, addr } = this.effIndDP(dp);
        if (this.m8) {
          const value = this.state.A & 0xff;
          this.write8(bank, addr, value);
        } else {
          const value = this.state.A & 0xffff;
          this.write16Cross(bank, addr, value & 0xffff);
        }
        break;
      }
      case 0x93: { // STA (sr),Y
        const sr = this.fetch8();
        const { bank, addr } = this.effSRY(sr);
        if (this.m8) {
          const value = this.state.A & 0xff;
          this.write8(bank, addr, value);
        } else {
          const value = this.state.A & 0xffff;
          this.write16Cross(bank, addr, value & 0xffff);
        }
        break;
      }
      case 0x83: { // STA sr (stack-relative)
        const sr = this.fetch8();
        const base = this.srBase();
        const eff = (base + (sr & 0xff)) & 0xffff;
        if (this.m8) {
          const value = this.state.A & 0xff;
          this.write8(0x00, eff, value);
        } else {
          const value = this.state.A & 0xffff;
          this.write16Cross(0x00, eff, value & 0xffff);
        }
        break;
      }
      case 0x87: { // STA [dp]
        const dp = this.fetch8();
        const ptr = (this.state.D + dp) & 0xffff;
        const lo = this.read8(0x00, ptr);
        const hi = this.read8(0x00, (ptr + 1) & 0xffff);
        const bank = this.read8(0x00, (ptr + 2) & 0xffff) & 0xff;
        const addr = ((hi << 8) | lo) & 0xffff;
        if (this.m8) {
          const value = this.state.A & 0xff;
          this.write8(bank, addr, value);
        } else {
          const value = this.state.A & 0xffff;
          this.write16Cross(bank, addr, value & 0xffff);
        }
        break;
      }
      case 0x97: { // STA [dp],Y
        const dp = this.fetch8();
        const { bank, addr } = this.effLongDPY(dp);
        if (this.m8) {
          const value = this.state.A & 0xff;
          this.write8(bank, addr, value);
        } else {
          const value = this.state.A & 0xffff;
          this.write16Cross(bank, addr, value & 0xffff);
        }
        break;
      }
case 0xc9: { // CMP #imm
        if (this.m8) {
          const imm = this.fetch8();
          this.cmpValues(this.state.A & 0xff, imm & 0xff, 8);
        } else {
          const imm = this.fetch16();
          this.cmpValues(this.state.A & 0xffff, imm & 0xffff, 16);
        }
        break;
      }
      case 0xc5: { // CMP dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.m8) {
          const v = this.read8(0x00, eff);
          this.cmpValues(this.state.A & 0xff, v, 8);
        } else {
          const v = this.read16(0x00, eff);
          this.cmpValues(this.state.A & 0xffff, v, 16);
        }
        break;
      }
      case 0xd5: { // CMP dp,X
        const dp = this.fetch8();
        const eff = this.effDPIndexed(dp, true);
        if (this.m8) {
          const v = this.read8(0x00, eff);
          this.cmpValues(this.state.A & 0xff, v, 8);
        } else {
          const v = this.read16(0x00, eff);
          this.cmpValues(this.state.A & 0xffff, v, 16);
        }
        break;
      }
      case 0xcd: { // CMP abs
        const addr = this.fetch16();
        if (this.m8) {
          const v = this.read8(this.state.DBR, addr);
          this.cmpValues(this.state.A & 0xff, v, 8);
        } else {
          const v = this.read16(this.state.DBR, addr);
          this.cmpValues(this.state.A & 0xffff, v, 16);
        }
        break;
      }
      case 0xdd: { // CMP abs,X
        const addr = this.fetch16();
        const { bank: effBank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexX());
        if (this.m8) {
          const v = this.read8(effBank, eff);
          this.cmpValues(this.state.A & 0xff, v, 8);
        } else {
          const v = this.read16(effBank, eff);
          this.cmpValues(this.state.A & 0xffff, v, 16);
        }
        break;
      }
      case 0xd9: { // CMP abs,Y
        const addr = this.fetch16();
        const { bank: effBank, addr: eff } = this.addIndexToAddress(this.state.DBR & 0xff, addr, this.indexY());
        if (this.m8) {
          const v = this.read8(effBank, eff);
          this.cmpValues(this.state.A & 0xff, v, 8);
        } else {
          const v = this.read16(effBank, eff);
          this.cmpValues(this.state.A & 0xffff, v, 16);
        }
        break;
      }
      case 0xc1: { // CMP (dp,X)
        const dp = this.fetch8();
        const off = (((dp & 0xff) + (this.state.X & 0xff)) & 0xff);
        const eff = this.dpPtr16(off);
        if (this.m8) {
          const v = this.read8(this.state.DBR, eff);
          this.cmpValues(this.state.A & 0xff, v, 8);
        } else {
          const v = this.read16(this.state.DBR, eff);
          this.cmpValues(this.state.A & 0xffff, v, 16);
        }
        break;
      }
      case 0xc3: { // CMP sr (stack relative)
        const sr = this.fetch8();
        const base = this.srBase();
        const eff = (base + (sr & 0xff)) & 0xffff;
        if (this.m8) {
          const v = this.read8(0x00, eff as Word);
          this.cmpValues(this.state.A & 0xff, v, 8);
        } else {
          const lo = this.read8(0x00, eff as Word);
          const hi = this.read8(0x00, ((eff + 1) & 0xffff) as Word);
          const v = ((hi << 8) | lo) & 0xffff;
          this.cmpValues(this.state.A & 0xffff, v, 16);
        }
        break;
      }
      case 0xd2: { // CMP (dp)
        const dp = this.fetch8();
        const eff = this.dpPtr16(dp);
        if (this.m8) {
          const v = this.read8(this.state.DBR, eff);
          this.cmpValues(this.state.A & 0xff, v, 8);
        } else {
          const v = this.read16(this.state.DBR, eff);
          this.cmpValues(this.state.A & 0xffff, v, 16);
        }
        break;
      }
      case 0xd1: { // CMP (dp),Y
        const dp = this.fetch8();
        const { bank, addr: eff } = this.effIndDPY(dp);
        if (this.m8) {
          const v = this.read8(bank, eff);
          this.cmpValues(this.state.A & 0xff, v, 8);
        } else {
          const v = this.read16(bank, eff);
          this.cmpValues(this.state.A & 0xffff, v, 16);
        }
        break;
      }
      case 0xd3: { // CMP (sr),Y
        const sr = this.fetch8();
        const { bank, addr: eff } = this.effSRY(sr);
        if (this.m8) {
          const v = this.read8(bank, eff);
          this.cmpValues(this.state.A & 0xff, v, 8);
        } else {
          const v = this.read16(bank, eff);
          this.cmpValues(this.state.A & 0xffff, v, 16);
        }
        break;
      }
      case 0xcf: { // CMP long
        const lo = this.fetch8();
        const hi = this.fetch8();
        const bank = this.fetch8() & 0xff;
        const addr = ((hi << 8) | lo) & 0xffff;
        if (this.m8) {
          const v = this.read8(bank, addr);
          this.cmpValues(this.state.A & 0xff, v, 8);
        } else {
          const v = this.read16Cross(bank, addr);
          this.cmpValues(this.state.A & 0xffff, v, 16);
        }
        break;
      }
      case 0xdf: { // CMP long,X
        const lo = this.fetch8();
        const hi = this.fetch8();
        const bank = this.fetch8() & 0xff;
        const base = ((hi << 8) | lo) & 0xffff;
        const sum24 = (bank << 16) | base;
        const indexed24 = (sum24 + this.indexX()) >>> 0;
        const effBank = (indexed24 >>> 16) & 0xff;
        const effAddr = indexed24 & 0xffff;
        if (this.m8) {
          const v = this.read8(effBank, effAddr);
          this.cmpValues(this.state.A & 0xff, v, 8);
        } else {
          const v = this.read16Cross(effBank, effAddr);
          this.cmpValues(this.state.A & 0xffff, v, 16);
        }
        break;
      }
      case 0xc7: { // CMP [dp]
        const dp = this.fetch8();
        const { bank, addr } = this.dpPtrLong(dp);
        if (this.m8) {
          const v = this.read8(bank, addr);
          this.cmpValues(this.state.A & 0xff, v, 8);
        } else {
          const v = this.read16Cross(bank, addr);
          this.cmpValues(this.state.A & 0xffff, v, 16);
        }
        break;
      }
      case 0xd7: { // CMP [dp],Y
        const dp = this.fetch8();
        const { bank, addr } = this.effLongDPY(dp);
        if (this.m8) {
          const v = this.read8(bank, addr);
          this.cmpValues(this.state.A & 0xff, v, 8);
        } else {
          const v = this.read16Cross(bank, addr);
          this.cmpValues(this.state.A & 0xffff, v, 16);
        }
        break;
      }
      case 0xe0: { // CPX #imm
        if (this.x8) {
          const imm = this.fetch8();
          this.cmpValues(this.state.X & 0xff, imm & 0xff, 8);
        } else {
          const imm = this.fetch16();
          this.cmpValues(this.state.X & 0xffff, imm & 0xffff, 16);
        }
        break;
      }
      case 0xe4: { // CPX dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.x8) {
          const v = this.read8(0x00, eff);
          this.cmpValues(this.state.X & 0xff, v, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const v = ((hi << 8) | lo) & 0xffff;
          this.cmpValues(this.state.X & 0xffff, v, 16);
        }
        break;
      }
      case 0xec: { // CPX abs
        const addr = this.fetch16();
        if (this.x8) {
          const v = this.read8(this.state.DBR, addr);
          this.cmpValues(this.state.X & 0xff, v, 8);
        } else {
          const v = this.read16(this.state.DBR, addr);
          this.cmpValues(this.state.X & 0xffff, v, 16);
        }
        break;
      }

      // CPY (uses Y width)
      case 0xc0: { // CPY #imm
        if (this.x8) {
          const imm = this.fetch8();
          this.cmpValues(this.state.Y & 0xff, imm & 0xff, 8);
        } else {
          const imm = this.fetch16();
          this.cmpValues(this.state.Y & 0xffff, imm & 0xffff, 16);
        }
        break;
      }
      case 0xc4: { // CPY dp
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        if (this.x8) {
          const v = this.read8(0x00, eff);
          this.cmpValues(this.state.Y & 0xff, v, 8);
        } else {
          const lo = this.read8(0x00, eff);
          const hi = this.read8(0x00, (eff + 1) & 0xffff);
          const v = ((hi << 8) | lo) & 0xffff;
          this.cmpValues(this.state.Y & 0xffff, v, 16);
        }
        break;
      }
      case 0xcc: { // CPY abs
        const addr = this.fetch16();
        if (this.x8) {
          const v = this.read8(this.state.DBR, addr);
          this.cmpValues(this.state.Y & 0xff, v, 8);
        } else {
          const v = this.read16(this.state.DBR, addr);
          this.cmpValues(this.state.Y & 0xffff, v, 16);
        }
        break;
      }

      // Stack-effective pushes and long branch: PEA/PEI/PER/BRL
      case 0xf4: { // PEA #imm16
        const lo = this.fetch8();
        const hi = this.fetch8();
        // Push high then low (matches 65C816 stack order for 16-bit pushes)
        this.push8(hi);
        this.push8(lo);
        break;
      }
      case 0xd4: { // PEI (dp)
        const dp = this.fetch8();
        const eff = (this.state.D + dp) & 0xffff;
        const lo = this.read8(0x00, eff);
        const hi = this.read8(0x00, (eff + 1) & 0xffff);
        // Push high then low
        this.push8(hi);
        this.push8(lo);
        break;
      }
      case 0x62: { // PER rel16
        const lo = this.fetch8();
        const hi = this.fetch8();
        const disp = ((hi << 8) | lo) << 16 >> 16; // sign-extend 16-bit
        const target = (this.state.PC + disp) & 0xffff;
        this.push8(target & 0xff);
        this.push8((target >>> 8) & 0xff);
        break;
      }
      case 0x82: { // BRL rel16
        const lo = this.fetch8();
        const hi = this.fetch8();
        const disp = ((hi << 8) | lo) << 16 >> 16;
        this.state.PC = (this.state.PC + disp) & 0xffff;
        break;
      }

      // Block move: MVP/MVN (source/dest banks immediates)
      case 0x54: { // MVP srcBank, dstBank (decrement X/Y)
        const dstBank = this.fetch8() & 0xff;
        const srcBank = this.fetch8() & 0xff;
        let count = this.m8 ? ((this.state.A & 0xff) + 1) : ((this.state.A & 0xffff) + 1);
        let x = this.state.X & 0xffff;
        let y = this.state.Y & 0xffff;
        while (count > 0) {
          const val = this.read8(srcBank, x as Word);
          this.write8(dstBank, y as Word, val);
          x = (x - 1) & 0xffff;
          y = (y - 1) & 0xffff;
          if (this.m8) this.state.A = (this.state.A & 0xff00) | ((this.state.A - 1) & 0xff);
          else this.state.A = (this.state.A - 1) & 0xffff;
          count--;
        }
        this.state.X = x;
        this.state.Y = y;
        break;
      }
      case 0x44: { // MVN srcBank, dstBank (increment X/Y)
        const dstBank = this.fetch8() & 0xff;
        const srcBank = this.fetch8() & 0xff;
        let count = this.m8 ? ((this.state.A & 0xff) + 1) : ((this.state.A & 0xffff) + 1);
        let x = this.state.X & 0xffff;
        let y = this.state.Y & 0xffff;
        while (count > 0) {
          const val = this.read8(srcBank, x as Word);
          this.write8(dstBank, y as Word, val);
          x = (x + 1) & 0xffff;
          y = (y + 1) & 0xffff;
          if (this.m8) this.state.A = (this.state.A & 0xff00) | ((this.state.A - 1) & 0xff);
          else this.state.A = (this.state.A - 1) & 0xffff;
          count--;
        }
        this.state.X = x;
        this.state.Y = y;
        break;
      }

      default:
        throw new Error(`Unimplemented opcode: ${opcode.toString(16)}`);
    }
  }
}

