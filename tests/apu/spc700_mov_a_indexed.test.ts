import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Tests for MOV A with dp+X and abs+X addressing and dp+X store.

describe('SMP MOV A indexed and dp+X store', () => {
  it('MOV A,$dp+X loads and sets flags; MOV $dp+X,A stores', () => {
    const apu: any = new APUDevice();
    const pc = 0x1280;

    apu.smp.PSW = 0x00; // P=0
    apu.smp.X = 0x02;
    apu.aram[0x0062] = 0x80; // $60+X -> $62

    apu.aram[pc + 0] = 0xF4; apu.aram[pc + 1] = 0x60; // MOV A,$60+X
    apu.aram[pc + 2] = 0xD5; apu.aram[pc + 3] = 0x61; // MOV $61+X,A -> $63

    apu.smp.PC = pc;
    apu.step(40);

    expect(apu.smp.A & 0xff).toBe(0x80);
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(1);
    expect(apu.aram[0x0063] & 0xff).toBe(0x80);
  });

  it('MOV A,$abs+X loads from absolute indexed', () => {
    const apu: any = new APUDevice();
    const pc = 0x12A0;

    apu.smp.X = 0x05;
    apu.aram[0x6005] = 0x22;

    apu.aram[pc + 0] = 0xF5; apu.aram[pc + 1] = 0x00; apu.aram[pc + 2] = 0x60; // MOV A,$6000+X

    apu.smp.PC = pc;
    apu.step(24);

    expect(apu.smp.A & 0xff).toBe(0x22);
    expect((apu.smp.PSW & 0x02) >>> 1).toBe(0);
    expect((apu.smp.PSW & 0x80) >>> 7).toBe(0);
  });
});

