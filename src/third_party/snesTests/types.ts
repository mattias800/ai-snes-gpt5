// Shared types and helpers for parsing and executing SNES CPU test vectors (third_party/snes-tests)
import { Flag } from '../../cpu/cpu65c816';

export type AddressingMode =
  | 'imm'
  | 'accum'
  | 'impl'
  | 'dp'
  | 'dpX'
  | 'dpY'
  | 'ind'
  | 'indX'
  | 'indY'
  | 'longInd'
  | 'longIndY'
  | 'abs'
  | 'absX'
  | 'absY'
  | 'long'
  | 'longX'
  | 'sr'
  | 'srY'
  // Jump-specific addressing (not executed initially by the vector runner)
  | 'indAbs'
  | 'absXInd'
  | 'longAbs'
  // Relative branches (not executed initially by the vector runner)
  | 'rel8'
  | 'rel16';

export interface CpuVector {
  id: number;           // numeric id parsed from hex (e.g., 0x000a)
  idHex: string;        // original hex id (e.g., '000a')
  insDisplay: string;   // full instruction display text from tests.txt (may include comments)
  op: string;           // lowercase mnemonic (e.g., 'adc')
  mode: AddressingMode; // normalized addressing mode
  operands: {           // parsed operands (one of these depending on mode)
    imm?: number;
    dp?: number;
    abs?: number;
    long?: number; // 24-bit
    sr?: number;
  };
  input: {              // initial CPU state
    A: number;
    X?: number;
    Y?: number;
    P: number;  // 8-bit
    E: number;  // 0|1
    S?: number;
    D?: number;
    DBR?: number;
  };
  memInit: { addr24: number; val: number }[];  // initial memory writes
  expected: {                                   // expected CPU state after executing the instruction
    A?: number;            // Only assert when provided by vector
    X?: number;
    Y?: number;
    P?: number;            // Only assert when provided by vector
    E?: number;            // Expected E is rarely provided; treat as optional
    S?: number;
    D?: number;
    DBR?: number;
  };
  memExpect: { addr24: number; val: number }[]; // expected memory bytes after execution
  requiresScaffolding: boolean;                 // true if tests.txt indicates extra asm setup/checks
  note?: string;                                // optional note line from tests.txt
}

export { Flag as Flags }; // re-export for convenience

export function hexToInt(s: string): number {
  return parseInt(s.replace(/^\$|^0x/i, ''), 16) >>> 0;
}

export function toHex(n: number, width: number): string {
  const mask = width >= 6 ? 0xffffff : width >= 4 ? 0xffff : width >= 2 ? 0xff : 0xf;
  return (n & mask).toString(16).toUpperCase().padStart(width, '0');
}

