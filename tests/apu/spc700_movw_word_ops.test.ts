import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

describe('SMP MOVW/INCW/DECW and ADDW/SUBW/CMPW, MUL, DIV, CBNE/DBNZ', () => {
  it('MOVW dp,YA then MOVW YA,dp round-trip', () => {
    const apu: any = new APUDevice();
    const pc = 0x0C00;
    apu.smp.A = 0x12; apu.smp.Y = 0x34;
    // MOVW $40,YA; clear Y,A; MOVW YA,$40
    apu.aram[pc + 0] = 0xDA; apu.aram[pc + 1] = 0x40; // MOVW dp,YA
    apu.aram[pc + 2] = 0xE8; apu.aram[pc + 3] = 0x00; // MOV A,#0
    apu.aram[pc + 4] = 0x8E; // POP PSW? No-op not allowed; use MOV A,#
    // replace POP PSW with MOV A,# since we don't need it; adjust sequence
    apu.aram[pc + 4] = 0xE8; apu.aram[pc + 5] = 0x00; // MOV A,#0
    apu.aram[pc + 6] = 0xBA; apu.aram[pc + 7] = 0x40; // MOVW YA,dp

    apu.smp.PC = pc;
    apu.step(13);

    expect(apu.smp.A & 0xff).toBe(0x12);
    expect(apu.smp.Y & 0xff).toBe(0x34);
  });

  it('INCW and DECW on dp 16-bit location', () => {
    const apu: any = new APUDevice();
    // Seed $50:$51 = 0x00FF
    apu.aram[0x0050] = 0xFF;
    apu.aram[0x0051] = 0x00;
    const pc = 0x0C40;
    apu.aram[pc + 0] = 0x3A; apu.aram[pc + 1] = 0x50; // INCW $50 -> 0x0100
    apu.aram[pc + 2] = 0x1A; apu.aram[pc + 3] = 0x50; // DECW $50 -> 0x00FF

    apu.smp.PC = pc;
    apu.step(64);
    expect(((apu.aram[0x0051] << 8) | apu.aram[0x0050]) & 0xffff).toBe(0x00FF);
  });

  it('ADDW, SUBW, CMPW basic behavior', () => {
    const apu: any = new APUDevice();
    const pc = 0x0C80;
    // YA=0x1234; $60=0x0001
    apu.smp.Y = 0x12; apu.smp.A = 0x34;
    apu.aram[0x0060] = 0x01; apu.aram[0x0061] = 0x00;
    // ADDW YA,$60 -> 0x1235; SUBW YA,$60 -> 0x1234; CMPW YA,$60 -> C=1 (>=)
    apu.aram[pc + 0] = 0x7A; apu.aram[pc + 1] = 0x60; // ADDW
    apu.aram[pc + 2] = 0x9A; apu.aram[pc + 3] = 0x60; // SUBW
    apu.aram[pc + 4] = 0x5A; apu.aram[pc + 5] = 0x60; // CMPW

    apu.smp.PC = pc;
    apu.step(96);
    expect(((apu.smp.Y << 8) | apu.smp.A) & 0xffff).toBe(0x1234);
    expect((apu.smp.PSW & 0x01) >>> 0).toBe(1); // C=1 after CMPW since 0x1234 >= 0x0001
  });

  it('MUL YA and DIV YA,X', () => {
    const apu: any = new APUDevice();
    const pc = 0x0CC0;
    // Y=0x34, A=0x12 -> result 0x03A8
    apu.smp.Y = 0x34; apu.smp.A = 0x12;
    apu.aram[pc + 0] = 0xCF; // MUL YA
    // Set YA to 0x03A8; Then set X=0x12 and DIV -> A=0x34, Y=0x00
    apu.aram[pc + 1] = 0x00; // NOP separator (do not clobber YA)
    apu.smp.X = 0x12;
    apu.aram[pc + 2] = 0x9E; // DIV YA,X

    apu.smp.PC = pc;
    apu.step(23);

    expect(((apu.smp.Y << 8) | apu.smp.A) & 0xffff).toBe(0x0034); // After DIV: YA = 0x0034? Actually A=0x34, Y=0x00
    expect(apu.smp.A & 0xff).toBe(0x34);
    expect(apu.smp.Y & 0xff).toBe(0x00);
  });

  it('CBNE dp,rel and DBNZ dp,rel and DBNZ Y,rel flow control', () => {
    const apu: any = new APUDevice();
    const pc = 0x0D00;
    // A=0x10; $70=0x11; CBNE $70,+2; MOV A,#$22 -> branch taken, MOV skipped
    apu.smp.A = 0x10; apu.aram[0x0070] = 0x11;
    apu.aram[pc + 0] = 0x2E; apu.aram[pc + 1] = 0x70; apu.aram[pc + 2] = 0x02; // CBNE
    apu.aram[pc + 3] = 0xE8; apu.aram[pc + 4] = 0x22; // MOV A,#$22 (skipped)

    // Next: DBNZ $71,+2 with $71=0x02 -> dec to 0x01 -> branch taken -> skip MOV A,#$33
    apu.aram[pc + 5] = 0x6E; apu.aram[pc + 6] = 0x71; apu.aram[pc + 7] = 0x02; // DBNZ $71,+2
    apu.aram[pc + 8] = 0xE8; apu.aram[pc + 9] = 0x33; // skipped
    apu.aram[0x0071] = 0x02;

    // Next: DBNZ Y,+2 with Y=1 -> dec to 0 -> not taken, execute MOV A,#$44
    apu.smp.Y = 0x01;
    apu.aram[pc + 10] = 0xFE; apu.aram[pc + 11] = 0x02; // DBNZ Y,+2
    apu.aram[pc + 12] = 0xE8; apu.aram[pc + 13] = 0x44; // executed

    apu.smp.PC = pc;
    apu.step(256);

    expect(apu.smp.A & 0xff).toBe(0x44);
    expect(apu.aram[0x0071] & 0xff).toBe(0x01);
  });
});
