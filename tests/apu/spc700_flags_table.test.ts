import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Flag masks
const N = 0x80, V = 0x40, P = 0x20, B = 0x10, H = 0x08, I = 0x04, Z = 0x02, C = 0x01;

type FlagEntry = {
  name: string;
  expectedCycles: number;
  program: number[]; // bytes
  setup?: (apu: any, pc: number) => void;
  expectPSW: number; // full expected PSW
  verify?: (apu: any) => void;
};

function runFlagEntry(e: FlagEntry) {
  const apu: any = new APUDevice();
  const pc = 0x2400;
  if (e.setup) e.setup(apu, pc);
  for (let i = 0; i < e.program.length; i++) apu.aram[(pc + i) & 0xffff] = e.program[i] & 0xff;
  apu.smp.PC = pc;
  apu.step(e.expectedCycles);
  expect(apu.smp.lastCycles | 0).toBe(e.expectedCycles);
  expect(apu.smp.PSW & 0xff).toBe(e.expectPSW & 0xff);
  if (e.verify) e.verify(apu);
}

describe('SPC700 flags and cycles (table-driven)', () => {
  const entries: FlagEntry[] = [
    // Logical operations
    {
      name: 'OR A,#imm preserves V, sets Z when result zero',
      expectedCycles: 2,
      program: [0x08, 0x00],
      setup: (apu) => { apu.smp.A = 0x00; apu.smp.PSW = V; },
      expectPSW: Z | V,
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x00); }
    },
    {
      name: 'OR A,[$dp+X] preserves V and sets Z when result zero',
      expectedCycles: 6,
      program: [0x07, 0x20],
      setup: (apu) => { apu.smp.PSW = V; apu.smp.X = 0x01; apu.smp.A = 0x00; apu.aram[0x0021] = 0x00; apu.aram[0x0022] = 0x60; apu.aram[0x6000] = 0x00; },
      expectPSW: Z | V,
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x00); }
    },
    {
      name: 'AND A,(X) preserves V and sets Z when mask clears to zero',
      expectedCycles: 4,
      program: [0x26],
      setup: (apu) => { apu.smp.PSW = V; apu.smp.X = 0x10; apu.smp.A = 0xF0; apu.aram[0x0010] = 0x0F; },
      expectPSW: Z | V,
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x00); }
    },
    {
      name: 'EOR A,abs+X sets N when result negative (V preserved)',
      expectedCycles: 5,
      program: [0x55, 0x00, 0x60],
      setup: (apu) => { apu.smp.PSW = V; apu.smp.X = 0x01; apu.smp.A = 0x80; apu.aram[0x6001] = 0x01; },
      expectPSW: N | V,
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x81); }
    },
    {
      name: 'OR A,dp sets N when result negative',
      expectedCycles: 3,
      program: [0x04, 0x40],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.A = 0x00; apu.aram[0x0040] = 0x80; },
      expectPSW: N,
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x80); }
    },
    {
      name: 'AND A,#imm sets Z when mask clears to zero (V preserved)',
      expectedCycles: 2,
      program: [0x28, 0x0F],
      setup: (apu) => { apu.smp.A = 0xF0; apu.smp.PSW = V; },
      expectPSW: Z | V,
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x00); }
    },
    {
      name: 'EOR A,#imm sets Z when xor to zero',
      expectedCycles: 2,
      program: [0x48, 0xAA],
      setup: (apu) => { apu.smp.A = 0xAA; },
      expectPSW: Z,
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x00); }
    },

    // Compare
    {
      name: 'CMP A,#imm equal => Z|C set',
      expectedCycles: 2,
      program: [0x68, 0x10],
      setup: (apu) => { apu.smp.A = 0x10; apu.smp.PSW = 0; },
      expectPSW: Z | C,
    },
    {
      name: 'CMP A,(X) greater => C set',
      expectedCycles: 4,
      program: [0x66],
      setup: (apu) => { apu.smp.PSW = 0; apu.smp.A = 0x20; apu.smp.X = 0x10; apu.aram[0x0010] = 0x10; },
      expectPSW: C,
    },
    {
      name: 'CMP A,abs equal => Z|C set',
      expectedCycles: 4,
      program: [0x65, 0x00, 0x62],
      setup: (apu) => { apu.smp.PSW = 0; apu.smp.A = 0x7F; apu.aram[0x6200] = 0x7F; },
      expectPSW: Z | C,
    },
    {
      name: 'CMP A,dp less => N set, C cleared',
      expectedCycles: 3,
      program: [0x64, 0x41],
      setup: (apu) => { apu.smp.A = 0x0F; apu.smp.PSW = 0; apu.aram[0x0041] = 0x10; },
      expectPSW: N,
    },

    // ADC cases
    {
      name: 'ADC A,#imm simple add no flags',
      expectedCycles: 2,
      program: [0x88, 0x34],
      setup: (apu) => { apu.smp.A = 0x12; apu.smp.PSW = 0; },
      expectPSW: 0,
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x46); }
    },
    {
      name: 'ADC A,#imm with carry and half-carry',
      expectedCycles: 2,
      program: [0x88, 0x34],
      setup: (apu) => { apu.smp.A = 0xCB; apu.smp.PSW = C; },
      expectPSW: Z | C | H, // 0x00 result, carry and half-carry
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x00); }
    },
    {
      name: 'ADC A,dp sets only H in 0x0F+1+carry case',
      expectedCycles: 3,
      program: [0x84, 0x40],
      setup: (apu) => { apu.smp.A = 0x0F; apu.smp.PSW = C; apu.aram[0x0040] = 0x01; },
      expectPSW: H,
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x11); }
    },
    {
      name: 'ADC A,abs+X sets Z|C|H on 0xFF+1',
      expectedCycles: 5,
      program: [0x95, 0x00, 0x60],
      setup: (apu) => { apu.smp.A = 0xFF; apu.smp.PSW = 0; apu.smp.X = 0x01; apu.aram[0x6001] = 0x01; },
      expectPSW: Z | C | H,
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x00); }
    },

    // SBC cases
    {
      name: 'SBC A,#imm no borrow => C set',
      expectedCycles: 2,
      program: [0xA8, 0x01],
      setup: (apu) => { apu.smp.A = 0x10; apu.smp.PSW = C; },
      expectPSW: 0 | C, // result 0x0F
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x0F); }
    },
    {
      name: 'SBC A,#imm borrow => C cleared, N set',
      expectedCycles: 2,
      program: [0xA8, 0x01],
      setup: (apu) => { apu.smp.A = 0x00; apu.smp.PSW = C; },
      expectPSW: N, // result 0xFF
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0xFF); }
    },
    {
      name: 'SBC A,(X) borrow => N set, C cleared',
      expectedCycles: 4,
      program: [0xA6],
      setup: (apu) => { apu.smp.PSW = C; apu.smp.A = 0x00; apu.smp.X = 0x10; apu.aram[0x0010] = 0x01; },
      expectPSW: N,
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0xFF); }
    },
    {
      name: 'SBC A,[$dp+X] borrow => N set, C cleared; H set if no borrow from bit4',
      expectedCycles: 6,
      program: [0xA7, 0x20],
      setup: (apu) => { apu.smp.PSW = C; apu.smp.A = 0x10; apu.smp.X = 0x02; apu.aram[0x0022] = 0x00; apu.aram[0x0023] = 0x61; apu.aram[0x6100] = 0x20; },
      expectPSW: N | H,
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0xF0); }
    },

    // Shifts/rotates
    {
      name: 'ASL A sets C from bit7, Z if zero',
      expectedCycles: 2,
      program: [0x1C],
      setup: (apu) => { apu.smp.A = 0x80; apu.smp.PSW = 0; },
      expectPSW: Z | C,
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x00); }
    },
    {
      name: 'LSR A sets C from bit0, clears N',
      expectedCycles: 2,
      program: [0x5C],
      setup: (apu) => { apu.smp.A = 0x01; apu.smp.PSW = N; },
      expectPSW: Z | C, // N cleared, result 0
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x00); }
    },
    {
      name: 'ROL A uses carry-in, updates C',
      expectedCycles: 2,
      program: [0x3C],
      setup: (apu) => { apu.smp.A = 0x80; apu.smp.PSW = C; },
      expectPSW: C, // carry out from bit7 = 1, result 0x01 => N=0 Z=0
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x01); }
    },
    {
      name: 'ROR A uses carry-in into bit7',
      expectedCycles: 2,
      program: [0x7C],
      setup: (apu) => { apu.smp.A = 0x01; apu.smp.PSW = C; },
      expectPSW: N | C, // LSB 1 -> C=1, carry-in 1 -> result has bit7 set
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x80); }
    },

    // Transfers affecting flags
    {
      name: 'MOV A,X updates Z/N',
      expectedCycles: 2,
      program: [0x5D],
      setup: (apu) => { apu.smp.X = 0x00; },
      expectPSW: Z,
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x00); }
    },
    {
      name: 'MOV X,A updates Z/N',
      expectedCycles: 2,
      program: [0x7D],
      setup: (apu) => { apu.smp.A = 0x80; },
      expectPSW: N,
      verify: (apu) => { expect(apu.smp.X & 0xff).toBe(0x80); }
    },

    // INC/DEC A
    {
      name: 'INC A sets Z when wraps to 0',
      expectedCycles: 2,
      program: [0xBC],
      setup: (apu) => { apu.smp.A = 0xFF; },
      expectPSW: Z,
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x00); }
    },
    {
      name: 'DEC A sets N when becomes 0xFF',
      expectedCycles: 2,
      program: [0x9C],
      setup: (apu) => { apu.smp.A = 0x00; },
      expectPSW: N,
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0xFF); }
    },

    // Memory shifts/rotates flags
    {
      name: 'ASL dp sets C from bit7, Z when result 0',
      expectedCycles: 4,
      program: [0x0B, 0x60],
      setup: (apu) => { apu.aram[0x0060] = 0x80; apu.smp.PSW = 0; },
      expectPSW: Z | C,
      verify: (apu) => { expect(apu.aram[0x0060] & 0xff).toBe(0x00); }
    },
    {
      name: 'LSR dp clears N, sets C from bit0',
      expectedCycles: 4,
      program: [0x4B, 0x61],
      setup: (apu) => { apu.aram[0x0061] = 0x01; apu.smp.PSW = N; },
      expectPSW: Z | C,
      verify: (apu) => { expect(apu.aram[0x0061] & 0xff).toBe(0x00); }
    },
    {
      name: 'ROL abs uses carry-in, sets C',
      expectedCycles: 5,
      program: [0x2C, 0x00, 0x40],
      setup: (apu) => { apu.aram[0x4000] = 0x80; apu.smp.PSW = C; },
      expectPSW: C,
      verify: (apu) => { expect(apu.aram[0x4000] & 0xff).toBe(0x01); }
    },
    {
      name: 'ROR dp+X uses carry-in -> bit7',
      expectedCycles: 5,
      program: [0x7B, 0x10],
      setup: (apu) => { apu.smp.X = 0x03; apu.aram[0x0013] = 0x00; apu.smp.PSW = C; },
      expectPSW: N,
      verify: (apu) => { expect(apu.aram[0x0013] & 0xff).toBe(0x80); }
    },

    // XCN
    {
      name: 'XCN sets N on 0xC3, clears Z',
      expectedCycles: 5,
      program: [0x9F],
      setup: (apu) => { apu.smp.A = 0x3C; },
      expectPSW: N,
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0xC3); }
    },

    // PSW control
    { name: 'CLRC (60) clears C only', expectedCycles: 2, program: [0x60], setup: (apu) => { apu.smp.PSW = C; }, expectPSW: 0 },
    { name: 'SETC (80) sets C', expectedCycles: 2, program: [0x80], setup: (apu) => { apu.smp.PSW = 0; }, expectPSW: C },
    { name: 'CLRP (20) clears P', expectedCycles: 2, program: [0x20], setup: (apu) => { apu.smp.PSW = P; }, expectPSW: 0 },
    { name: 'SETP (40) sets P', expectedCycles: 2, program: [0x40], setup: (apu) => { apu.smp.PSW = 0; }, expectPSW: P },
    { name: 'CLRV (E0) clears V and H', expectedCycles: 2, program: [0xE0], setup: (apu) => { apu.smp.PSW = V | H; }, expectPSW: 0 },
    { name: 'EI (A0) sets I', expectedCycles: 2, program: [0xA0], setup: (apu) => { apu.smp.PSW = 0; }, expectPSW: I },
    { name: 'DI (C0) clears I', expectedCycles: 2, program: [0xC0], setup: (apu) => { apu.smp.PSW = I; }, expectPSW: 0 },
  ];

  for (const e of entries) it(e.name, () => runFlagEntry(e));
});

