import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

// Test CALL abs (3F), RET (6F), and RETI (7F)

describe('SMP CALL/RET/RETI', () => {
  it('CALL jumps to subroutine and RET returns; sub writes a marker to DP', () => {
    const apu: any = new APUDevice();
    const main = 0x0B00;
    const sub = 0x0B20;

    // Main: CALL sub; MOV A,#$55
    apu.aram[main + 0] = 0x3F; // CALL abs
    apu.aram[main + 1] = sub & 0xff; // low
    apu.aram[main + 2] = (sub >>> 8) & 0xff; // high
    apu.aram[main + 3] = 0xE8; // MOV A,#$55
    apu.aram[main + 4] = 0x55;

    // Sub: MOV A,#$77; MOV $20,A; RET
    apu.aram[sub + 0] = 0xE8; apu.aram[sub + 1] = 0x77;
    apu.aram[sub + 2] = 0xC5; apu.aram[sub + 3] = 0x20; // MOV $20,A
    apu.aram[sub + 4] = 0x6F; // RET

    apu.smp.PC = main;
    apu.step(20);

    expect(apu.aram[0x0020] & 0xff).toBe(0x77); // sub executed
    expect(apu.smp.A & 0xff).toBe(0x55); // code after CALL executed
  });

  it('RETI pops PSW and PC: preseed stack and execute RETI', () => {
    const apu: any = new APUDevice();
    const target = 0x0B50;
    const start = 0x0B40;

    // Place target instruction
    apu.aram[target + 0] = 0xE8; apu.aram[target + 1] = 0xAA; // MOV A,#$AA

    // Place RETI at start
    apu.aram[start + 0] = 0x7F; // RETI

    // Preseed stack so RETI will pop PSW and then PC low/high
    // SP progression: pop reads from SP+1. Let SP start at 0xFC so:
    // [01FD]=PSW, [01FE]=PCL, [01FF]=PCH
    apu.smp.SP = 0xFC;
    apu.aram[0x01FD] = 0xA4; // PSW test pattern (N + H + I)
    apu.aram[0x01FE] = target & 0xff; // low
    apu.aram[0x01FF] = (target >>> 8) & 0xff; // high

    apu.smp.PC = start;
    apu.step(8);

    expect(apu.smp.PC & 0xffff).toBe((target + 2) & 0xffff); // after MOV A,#
    expect(apu.smp.A & 0xff).toBe(0xAA);
    expect(apu.smp.PSW & 0xff).toBe(0xA4);
  });
});
