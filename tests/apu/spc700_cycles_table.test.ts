import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

type Entry = {
  name: string;
  expectedCycles: number;
  program: number[]; // instruction bytes
  setup?: (apu: any, pc: number) => void; // init regs/mem
  verify?: (apu: any) => void; // optional state checks
};

function runEntry(e: Entry) {
  const apu: any = new APUDevice();
  const pc = 0x2200;
  if (e.setup) e.setup(apu, pc);
  for (let i = 0; i < e.program.length; i++) apu.aram[(pc + i) & 0xffff] = e.program[i] & 0xff;
  apu.smp.PC = pc;
  apu.step(e.expectedCycles);
  expect(apu.smp.lastCycles | 0).toBe(e.expectedCycles);
  if (e.verify) e.verify(apu);
}

describe('SPC700 cycles (table-driven)', () => {
  const entries: Entry[] = [
    {
      name: 'MOV A,#imm (E8) = 2',
      expectedCycles: 2,
      program: [0xE8, 0x5A],
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x5A); }
    },
    {
      name: 'MOV A,dp (E4) = 3',
      expectedCycles: 3,
      program: [0xE4, 0x34],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.aram[0x0034] = 0x12; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x12); }
    },
    {
      name: 'MOV dp,A (C5) = 3',
      expectedCycles: 3,
      program: [0xC5, 0x35],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.A = 0x77; },
      verify: (apu) => { expect(apu.aram[0x0035] & 0xff).toBe(0x77); }
    },
    {
      name: 'MOV A,abs (E5) = 4',
      expectedCycles: 4,
      program: [0xE5, 0x56, 0x34],
      setup: (apu) => { apu.aram[0x3456] = 0x9C; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x9C); }
    },
    {
      name: 'MOV abs,A (C4) = 5',
      expectedCycles: 5,
      program: [0xC4, 0x57, 0x34],
      setup: (apu) => { apu.smp.A = 0x9D; },
      verify: (apu) => { expect(apu.aram[0x3457] & 0xff).toBe(0x9D); }
    },
    {
      name: 'MOV A,dp+X (F4) = 4',
      expectedCycles: 4,
      program: [0xF4, 0x40],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.X = 0x02; apu.aram[0x0042] = 0x77; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x77); }
    },
    {
      name: 'MOV dp+X,A (D5) = 4',
      expectedCycles: 4,
      program: [0xD5, 0x41],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.X = 0x02; apu.smp.A = 0x88; },
      verify: (apu) => { expect(apu.aram[0x0043] & 0xff).toBe(0x88); }
    },
    {
      name: 'MOV A,(X) (E6) = 4',
      expectedCycles: 4,
      program: [0xE6],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.X = 0x10; apu.aram[0x0010] = 0xA5; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0xA5); }
    },
    {
      name: 'MOV (X),A (C6) = 4',
      expectedCycles: 4,
      program: [0xC6],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.X = 0x12; apu.smp.A = 0x5A; },
      verify: (apu) => { expect(apu.aram[0x0012] & 0xff).toBe(0x5A); }
    },
    {
      name: 'MOV A,[$dp+X] (E7) = 6',
      expectedCycles: 6,
      program: [0xE7, 0x20],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.X = 0x03; apu.aram[0x0023] = 0x00; apu.aram[0x0024] = 0x41; apu.aram[0x4100] = 0x55; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x55); }
    },
    {
      name: 'MOV [$dp+X],A (C7) = 7',
      expectedCycles: 7,
      program: [0xC7, 0x21],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.X = 0x02; apu.aram[0x0023] = 0x00; apu.aram[0x0024] = 0x41; apu.smp.A = 0x66; },
      verify: (apu) => { expect(apu.aram[0x4100] & 0xff).toBe(0x66); }
    },
    {
      name: 'MOV Y,abs (EC) = 4',
      expectedCycles: 4,
      program: [0xEC, 0x33, 0x22],
      setup: (apu) => { apu.aram[0x2233] = 0x7E; },
      verify: (apu) => { expect(apu.smp.Y & 0xff).toBe(0x7E); }
    },
    {
      name: 'MOV abs,Y (CC) = 5',
      expectedCycles: 5,
      program: [0xCC, 0x34, 0x22],
      setup: (apu) => { apu.smp.Y = 0x7E; },
      verify: (apu) => { expect(apu.aram[0x2234] & 0xff).toBe(0x7E); }
    },
    {
      name: 'INC dp (AB) = 4',
      expectedCycles: 4,
      program: [0xAB, 0x50],
      setup: (apu) => { apu.aram[0x0050] = 0x01; },
      verify: (apu) => { expect(apu.aram[0x0050] & 0xff).toBe(0x02); }
    },
    {
      name: 'DEC abs (8C) = 5',
      expectedCycles: 5,
      program: [0x8C, 0x00, 0x33],
      setup: (apu) => { apu.aram[0x3300] = 0x10; },
      verify: (apu) => { expect(apu.aram[0x3300] & 0xff).toBe(0x0F); }
    },
    {
      name: 'ADC A,#imm (88) = 2',
      expectedCycles: 2,
      program: [0x88, 0x10],
      setup: (apu) => { apu.smp.A = 0x00; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x10); }
    },
    {
      name: 'ADC A,abs (85) = 4',
      expectedCycles: 4,
      program: [0x85, 0x34, 0x12],
      setup: (apu) => { apu.aram[0x1234] = 0x10; apu.smp.A = 0x0F; apu.smp.PSW = 0; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x1F); }
    },
    {
      name: 'ADC A,dp+X (94) = 4',
      expectedCycles: 4,
      program: [0x94, 0x40],
      setup: (apu) => { apu.smp.X = 0x02; apu.aram[0x0042] = 0x01; apu.smp.A = 0x01; apu.smp.PSW = 0; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x02); }
    },
    {
      name: 'AND A,dp (24) = 3',
      expectedCycles: 3,
      program: [0x24, 0x40],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.A = 0xF0; apu.aram[0x0040] = 0x0F; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x00); }
    },
    {
      name: 'EOR A,dp (44) = 3',
      expectedCycles: 3,
      program: [0x44, 0x41],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.A = 0x00; apu.aram[0x0041] = 0xAA; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0xAA); }
    },
    {
      name: 'XCN (9F) = 5',
      expectedCycles: 5,
      program: [0x9F],
      setup: (apu) => { apu.smp.A = 0x3C; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0xC3); }
    },
    // Memory shifts/rotates cycles
    {
      name: 'ASL dp (0B) = 4',
      expectedCycles: 4,
      program: [0x0B, 0x60],
      setup: (apu) => { apu.aram[0x0060] = 0x80; },
      verify: (apu) => { expect(apu.aram[0x0060] & 0xff).toBe(0x00); }
    },
    {
      name: 'ASL abs (0C) = 5',
      expectedCycles: 5,
      program: [0x0C, 0x00, 0x40],
      setup: (apu) => { apu.aram[0x4000] = 0x01; },
      verify: (apu) => { expect(apu.aram[0x4000] & 0xff).toBe(0x02); }
    },
    {
      name: 'ASL dp+X (1B) = 5',
      expectedCycles: 5,
      program: [0x1B, 0x20],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.X = 0x02; apu.aram[0x0022] = 0x40; },
      verify: (apu) => { expect(apu.aram[0x0022] & 0xff).toBe(0x80); }
    },
    {
      name: 'ROL abs (2C) = 5',
      expectedCycles: 5,
      program: [0x2C, 0x01, 0x40],
      setup: (apu) => { apu.aram[0x4001] = 0x80; apu.smp.PSW = 0x00; },
      verify: (apu) => { expect(apu.aram[0x4001] & 0xff).toBe(0x00); }
    },
    {
      name: 'LSR dp (4B) = 4',
      expectedCycles: 4,
      program: [0x4B, 0x61],
      setup: (apu) => { apu.aram[0x0061] = 0x01; },
      verify: (apu) => { expect(apu.aram[0x0061] & 0xff).toBe(0x00); }
    },
    {
      name: 'ROR dp+X (7B) = 5',
      expectedCycles: 5,
      program: [0x7B, 0x10],
      setup: (apu) => { apu.smp.X = 0x03; apu.aram[0x0013] = 0x01; apu.smp.PSW = 0; },
      verify: (apu) => { expect(apu.aram[0x0013] & 0xff).toBe(0x00); }
    },

    // Additional ALU immediate/direct
    {
      name: 'OR A,#imm (08) = 2',
      expectedCycles: 2,
      program: [0x08, 0x0F],
      setup: (apu) => { apu.smp.A = 0xF0; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0xFF); }
    },
    {
      name: 'OR A,dp (04) = 3',
      expectedCycles: 3,
      program: [0x04, 0x40],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.A = 0xF0; apu.aram[0x0040] = 0x0F; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0xFF); }
    },
    {
      name: 'OR A,abs (05) = 4',
      expectedCycles: 4,
      program: [0x05, 0x00, 0x40],
      setup: (apu) => { apu.aram[0x4000] = 0x0F; apu.smp.A = 0xF0; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0xFF); }
    },
    {
      name: 'OR A,(X) (06) = 4',
      expectedCycles: 4,
      program: [0x06],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.X = 0x20; apu.aram[0x0020] = 0xAA; apu.smp.A = 0x55; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0xFF); }
    },
    {
      name: 'OR A,[$dp+X] (07) = 6',
      expectedCycles: 6,
      program: [0x07, 0x30],
      setup: (apu) => { apu.smp.X = 0x02; apu.aram[0x0032] = 0x00; apu.aram[0x0033] = 0x50; apu.aram[0x5000] = 0x0F; apu.smp.A = 0xF0; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0xFF); }
    },
    {
      name: 'OR A,dp+X (14) = 4',
      expectedCycles: 4,
      program: [0x14, 0x60],
      setup: (apu) => { apu.smp.X = 0x03; apu.aram[0x0063] = 0x0F; apu.smp.A = 0xF0; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0xFF); }
    },
    {
      name: 'ADC A,abs+X (95) = 5',
      expectedCycles: 5,
      program: [0x95, 0x00, 0x60],
      setup: (apu) => { apu.smp.X = 0x01; apu.aram[0x6001] = 0x0F; apu.smp.A = 0xF0; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0xFF); }
    },
    // Fill out remaining ADC/SBC addressing mode cycles
    {
      name: 'ADC A,dp (84) = 3',
      expectedCycles: 3,
      program: [0x84, 0x40],
      setup: (apu) => { apu.aram[0x0040] = 0x01; apu.smp.A = 0x01; apu.smp.PSW = 0; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x02); }
    },
    {
      name: 'ADC A,(X) (86) = 4',
      expectedCycles: 4,
      program: [0x86],
      setup: (apu) => { apu.smp.PSW = 0; apu.smp.X = 0x10; apu.aram[0x0010] = 0x01; apu.smp.A = 0x01; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x02); }
    },
    {
      name: 'ADC A,[$dp+X] (87) = 6',
      expectedCycles: 6,
      program: [0x87, 0x20],
      setup: (apu) => { apu.smp.X = 0x02; apu.aram[0x0022] = 0x00; apu.aram[0x0023] = 0x61; apu.aram[0x6100] = 0x01; apu.smp.A = 0x01; apu.smp.PSW = 0; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x02); }
    },
    {
      name: 'SBC A,dp (A4) = 3',
      expectedCycles: 3,
      program: [0xA4, 0x40],
      setup: (apu) => { apu.smp.PSW = 0x01; apu.smp.A = 0x10; apu.aram[0x0040] = 0x01; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x0F); }
    },
    {
      name: 'SBC A,abs (A5) = 4',
      expectedCycles: 4,
      program: [0xA5, 0x00, 0x61],
      setup: (apu) => { apu.smp.PSW = 0x01; apu.smp.A = 0x10; apu.aram[0x6100] = 0x01; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x0F); }
    },
    {
      name: 'SBC A,[$dp+X] (A7) = 6',
      expectedCycles: 6,
      program: [0xA7, 0x20],
      setup: (apu) => { apu.smp.PSW = 0x01; apu.smp.X = 0x02; apu.smp.A = 0x10; apu.aram[0x0022] = 0x00; apu.aram[0x0023] = 0x61; apu.aram[0x6100] = 0x01; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x0F); }
    },
    {
      name: 'SBC A,dp+X (B4) = 4',
      expectedCycles: 4,
      program: [0xB4, 0x40],
      setup: (apu) => { apu.smp.PSW = 0x01; apu.smp.X = 0x02; apu.smp.A = 0x10; apu.aram[0x0042] = 0x01; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x0F); }
    },
    {
      name: 'SBC A,abs+X (B5) = 5',
      expectedCycles: 5,
      program: [0xB5, 0x00, 0x61],
      setup: (apu) => { apu.smp.PSW = 0x01; apu.smp.X = 0x01; apu.smp.A = 0x10; apu.aram[0x6101] = 0x01; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x0F); }
    },
    {
      name: 'AND A,#imm (28) = 2',
      expectedCycles: 2,
      program: [0x28, 0x0F],
      setup: (apu) => { apu.smp.A = 0xF0; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x00); }
    },
    {
      name: 'AND A,abs+X (35) = 5',
      expectedCycles: 5,
      program: [0x35, 0x10, 0x40],
      setup: (apu) => { apu.smp.X = 0x02; apu.aram[0x4012] = 0x0F; apu.smp.A = 0xF0; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x00); }
    },
    {
      name: 'EOR A,#imm (48) = 2',
      expectedCycles: 2,
      program: [0x48, 0xAA],
      setup: (apu) => { apu.smp.A = 0xAA; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x00); }
    },
    {
      name: 'EOR A,[$dp+X] (47) = 6',
      expectedCycles: 6,
      program: [0x47, 0x20],
      setup: (apu) => { apu.smp.X = 0x03; apu.aram[0x0023] = 0x00; apu.aram[0x0024] = 0x41; apu.aram[0x4100] = 0xFF; apu.smp.A = 0x0F; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0xF0); }
    },

    // Fill out remaining AND/EOR addressing mode cycles
    {
      name: 'AND A,abs (25) = 4',
      expectedCycles: 4,
      program: [0x25, 0x10, 0x60],
      setup: (apu) => { apu.aram[0x6010] = 0x0F; apu.smp.A = 0xF0; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x00); }
    },
    {
      name: 'AND A,(X) (26) = 4',
      expectedCycles: 4,
      program: [0x26],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.X = 0x10; apu.aram[0x0010] = 0x0F; apu.smp.A = 0xF0; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x00); }
    },
    {
      name: 'AND A,[$dp+X] (27) = 6',
      expectedCycles: 6,
      program: [0x27, 0x20],
      setup: (apu) => { apu.smp.X = 0x01; apu.aram[0x0021] = 0x00; apu.aram[0x0022] = 0x60; apu.aram[0x6000] = 0x0F; apu.smp.A = 0xF0; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x00); }
    },
    {
      name: 'AND A,dp+X (34) = 4',
      expectedCycles: 4,
      program: [0x34, 0x40],
      setup: (apu) => { apu.smp.X = 0x02; apu.aram[0x0042] = 0x0F; apu.smp.A = 0xF0; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x00); }
    },
    {
      name: 'EOR A,abs (45) = 4',
      expectedCycles: 4,
      program: [0x45, 0x00, 0x62],
      setup: (apu) => { apu.aram[0x6200] = 0x0F; apu.smp.A = 0xF0; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0xFF); }
    },
    {
      name: 'EOR A,(X) (46) = 4',
      expectedCycles: 4,
      program: [0x46],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.X = 0x12; apu.aram[0x0012] = 0x0F; apu.smp.A = 0xF0; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0xFF); }
    },
    {
      name: 'EOR A,dp+X (54) = 4',
      expectedCycles: 4,
      program: [0x54, 0x50],
      setup: (apu) => { apu.smp.X = 0x03; apu.aram[0x0053] = 0xFF; apu.smp.A = 0x0F; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0xF0); }
    },

    // CMP immediate/direct
    {
      name: 'CMP A,#imm (68) = 2',
      expectedCycles: 2,
      program: [0x68, 0x20],
      setup: (apu) => { apu.smp.A = 0x10; },
    },
    {
      name: 'CMP A,dp (64) = 3',
      expectedCycles: 3,
      program: [0x64, 0x41],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.A = 0x10; apu.aram[0x0041] = 0x0F; },
    },
    {
      name: 'CMP A,abs+X (75) = 5',
      expectedCycles: 5,
      program: [0x75, 0x00, 0x60],
      setup: (apu) => { apu.smp.A = 0x10; apu.smp.X = 0x01; apu.aram[0x6001] = 0x0F; },
    },
    {
      name: 'CMP A,abs (65) = 4',
      expectedCycles: 4,
      program: [0x65, 0x10, 0x60],
      setup: (apu) => { apu.smp.A = 0x20; apu.aram[0x6010] = 0x10; },
    },
    {
      name: 'CMP A,(X) (66) = 4',
      expectedCycles: 4,
      program: [0x66],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.X = 0x08; apu.smp.A = 0x20; apu.aram[0x0008] = 0x10; },
    },
    {
      name: 'CMP A,[$dp+X] (67) = 6',
      expectedCycles: 6,
      program: [0x67, 0x20],
      setup: (apu) => { apu.smp.X = 0x02; apu.smp.A = 0x10; apu.aram[0x0022] = 0x00; apu.aram[0x0023] = 0x61; apu.aram[0x6100] = 0x20; },
    },
    {
      name: 'CMP A,dp+X (74) = 4',
      expectedCycles: 4,
      program: [0x74, 0x40],
      setup: (apu) => { apu.smp.X = 0x03; apu.smp.A = 0x10; apu.aram[0x0043] = 0x0F; },
    },

    // INC/DEC dp+X
    {
      name: 'INC dp+X (BB) = 5',
      expectedCycles: 5,
      program: [0xBB, 0x60],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.X = 0x03; apu.aram[0x0063] = 0x01; },
      verify: (apu) => { expect(apu.aram[0x0063] & 0xff).toBe(0x02); }
    },
    {
      name: 'DEC dp+X (9B) = 5',
      expectedCycles: 5,
      program: [0x9B, 0x60],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.X = 0x03; apu.aram[0x0063] = 0x02; },
      verify: (apu) => { expect(apu.aram[0x0063] & 0xff).toBe(0x01); }
    },

    // Branches
    {
      name: 'BNE not taken (D0) = 2',
      expectedCycles: 2,
      program: [0xD0, 0x02],
      setup: (apu) => { apu.smp.PSW = apu.smp.PSW | 0x02; }, // Z=1
    },
    {
      name: 'BNE taken (D0) = 4',
      expectedCycles: 4,
      program: [0xD0, 0x02],
      setup: (apu) => { apu.smp.PSW &= ~0x02; }, // Z=0
    },
    {
      name: 'BEQ taken (F0) = 4',
      expectedCycles: 4,
      program: [0xF0, 0x02],
      setup: (apu) => { apu.smp.PSW = apu.smp.PSW | 0x02; }, // Z=1
    },
    {
      name: 'BEQ not taken (F0) = 2',
      expectedCycles: 2,
      program: [0xF0, 0x02],
      setup: (apu) => { apu.smp.PSW &= ~0x02; }, // Z=0
    },
    {
      name: 'BCC taken (90) = 4',
      expectedCycles: 4,
      program: [0x90, 0x02],
      setup: (apu) => { apu.smp.PSW &= ~0x01; }, // C=0
    },
    {
      name: 'BCC not taken (90) = 2',
      expectedCycles: 2,
      program: [0x90, 0x02],
      setup: (apu) => { apu.smp.PSW |= 0x01; }, // C=1
    },
    {
      name: 'BCS taken (B0) = 4',
      expectedCycles: 4,
      program: [0xB0, 0x02],
      setup: (apu) => { apu.smp.PSW |= 0x01; }, // C=1
    },
    {
      name: 'BCS not taken (B0) = 2',
      expectedCycles: 2,
      program: [0xB0, 0x02],
      setup: (apu) => { apu.smp.PSW &= ~0x01; }, // C=0
    },
    {
      name: 'BMI taken (30) = 4',
      expectedCycles: 4,
      program: [0x30, 0x02],
      setup: (apu) => { apu.smp.PSW |= 0x80; }, // N=1
    },
    {
      name: 'BMI not taken (30) = 2',
      expectedCycles: 2,
      program: [0x30, 0x02],
      setup: (apu) => { apu.smp.PSW &= ~0x80; }, // N=0
    },
    {
      name: 'BPL taken (10) = 4',
      expectedCycles: 4,
      program: [0x10, 0x02],
      setup: (apu) => { apu.smp.PSW &= ~0x80; }, // N=0
    },
    {
      name: 'BPL not taken (10) = 2',
      expectedCycles: 2,
      program: [0x10, 0x02],
      setup: (apu) => { apu.smp.PSW |= 0x80; }, // N=1
    },
    {
      name: 'BVC taken (50) = 4',
      expectedCycles: 4,
      program: [0x50, 0x02],
      setup: (apu) => { apu.smp.PSW &= ~0x40; }, // V=0
    },
    {
      name: 'BVC not taken (50) = 2',
      expectedCycles: 2,
      program: [0x50, 0x02],
      setup: (apu) => { apu.smp.PSW |= 0x40; }, // V=1
    },
    {
      name: 'BVS taken (70) = 4',
      expectedCycles: 4,
      program: [0x70, 0x02],
      setup: (apu) => { apu.smp.PSW |= 0x40; }, // V=1
    },
    {
      name: 'BVS not taken (70) = 2',
      expectedCycles: 2,
      program: [0x70, 0x02],
      setup: (apu) => { apu.smp.PSW &= ~0x40; }, // V=0
    },
    {
      name: 'BRA rel8 (2F) = 2',
      expectedCycles: 2,
      program: [0x2F, 0x02],
    },

    // Control flow
    {
      name: 'JMP abs (5F) = 3',
      expectedCycles: 3,
      program: [0x5F, 0x34, 0x12],
      verify: (apu) => { expect(apu.smp.PC & 0xffff).toBe(0x1234); }
    },
    {
      name: 'CALL abs (3F) = 8',
      expectedCycles: 8,
      program: [0x3F, 0x00, 0x12],
      verify: (apu) => { expect(apu.smp.PC & 0xffff).toBe(0x1200); }
    },
    {
      name: 'RET (6F) = 5',
      expectedCycles: 5,
      program: [0x6F],
      setup: (apu) => { apu.smp.SP = 0xFD; apu.aram[0x01FE] = 0x23; apu.aram[0x01FF] = 0x45; },
      verify: (apu) => { expect(apu.smp.PC & 0xffff).toBe(0x2345); }
    },

    // Word ops
    {
      name: 'MOVW YA,dp (BA) = 5',
      expectedCycles: 5,
      program: [0xBA, 0x50],
      setup: (apu) => { apu.aram[0x0050] = 0x78; apu.aram[0x0051] = 0x56; },
      verify: (apu) => { expect(apu.smp.A & 0xff).toBe(0x78); expect(apu.smp.Y & 0xff).toBe(0x56); }
    },
    {
      name: 'MOVW dp,YA (DA) = 4',
      expectedCycles: 4,
      program: [0xDA, 0x52],
      setup: (apu) => { apu.smp.A = 0x34; apu.smp.Y = 0x12; },
      verify: (apu) => { expect(apu.aram[0x0052] & 0xff).toBe(0x34); expect(apu.aram[0x0053] & 0xff).toBe(0x12); }
    },
    {
      name: 'ADDW YA,dp (7A) = 5',
      expectedCycles: 5,
      program: [0x7A, 0x54],
      setup: (apu) => { apu.smp.A = 0xFF; apu.smp.Y = 0x00; apu.aram[0x0054] = 0x01; apu.aram[0x0055] = 0x00; },
      verify: (apu) => { expect(((apu.smp.Y << 8) | apu.smp.A) & 0xffff).toBe(0x0100); }
    },
    {
      name: 'SUBW YA,dp (9A) = 5',
      expectedCycles: 5,
      program: [0x9A, 0x56],
      setup: (apu) => { apu.smp.A = 0x00; apu.smp.Y = 0x01; apu.aram[0x0056] = 0x01; apu.aram[0x0057] = 0x00; },
      verify: (apu) => { expect(((apu.smp.Y << 8) | apu.smp.A) & 0xffff).toBe(0x00FF); }
    },
    {
      name: 'INCW dp (3A) = 6',
      expectedCycles: 6,
      program: [0x3A, 0x58],
      setup: (apu) => { apu.aram[0x0058] = 0xFF; apu.aram[0x0059] = 0x00; },
      verify: (apu) => { expect((apu.aram[0x0058] | (apu.aram[0x0059] << 8)) & 0xffff).toBe(0x0100); }
    },
    {
      name: 'DECW dp (1A) = 6',
      expectedCycles: 6,
      program: [0x1A, 0x5A],
      setup: (apu) => { apu.aram[0x005A] = 0x00; apu.aram[0x005B] = 0x01; },
      verify: (apu) => { expect((apu.aram[0x005A] | (apu.aram[0x005B] << 8)) & 0xffff).toBe(0x00FF); }
    },

    // CBNE/DBNZ
    {
      name: 'CBNE dp,rel not equal (2E) = 7',
      expectedCycles: 7,
      program: [0x2E, 0x60, 0x02],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.A = 0x01; apu.aram[0x0060] = 0x02; },
    },
    {
      name: 'CBNE dp,rel equal (2E) = 5',
      expectedCycles: 5,
      program: [0x2E, 0x61, 0x02],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.A = 0x03; apu.aram[0x0061] = 0x03; },
    },
    {
      name: 'CBNE dp+X,rel not equal (DE) = 7',
      expectedCycles: 7,
      program: [0xDE, 0x60, 0x02],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.X = 0x02; apu.smp.A = 0x01; apu.aram[0x0062] = 0x02; },
    },
    {
      name: 'CBNE dp+X,rel equal (DE) = 5',
      expectedCycles: 5,
      program: [0xDE, 0x61, 0x02],
      setup: (apu) => { apu.smp.PSW = 0x00; apu.smp.X = 0x03; apu.smp.A = 0x03; apu.aram[0x0064] = 0x03; },
    },
    {
      name: 'DBNZ dp,rel branch (6E) = 7',
      expectedCycles: 7,
      program: [0x6E, 0x62, 0xFE],
      setup: (apu) => { apu.aram[0x0062] = 0x02; },
      verify: (apu) => { expect(apu.aram[0x0062] & 0xff).toBe(0x01); }
    },
    {
      name: 'DBNZ Y,rel branch (FE) = 6',
      expectedCycles: 6,
      program: [0xFE, 0x02],
      setup: (apu) => { apu.smp.Y = 0x02; },
      verify: (apu) => { expect(apu.smp.Y & 0xff).toBe(0x01); }
    }
  ];

  for (const e of entries) {
    it(e.name, () => runEntry(e));
  }
});

