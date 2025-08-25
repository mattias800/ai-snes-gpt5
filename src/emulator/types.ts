export type Byte = number; // 0..255
export type Word = number; // 0..65535
export type DWord = number; // 0..0xFFFFFFFF

export interface IMemoryBus {
  read8(addr: number): Byte;
  read16(addr: number): Word;
  write8(addr: number, value: Byte): void;
  write16(addr: number, value: Word): void;
}

export interface IClocked {
  step(cycles: number): void; // advance a component's internal clock by cycles
}

export interface IEmulator {
  reset(): void;
  stepInstruction(): void; // step one CPU instruction (advances sub-components deterministically)
}

