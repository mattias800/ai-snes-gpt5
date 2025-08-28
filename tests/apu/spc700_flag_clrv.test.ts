import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

describe('SMP CLRV clears V and H only', () => {
  it('CLRV (0xE0) clears V and H, preserving others', () => {
    const apu: any = new APUDevice();
    const pc = 0x0EA0;

    // Set all flags, then CLRV should clear V and H only
    apu.smp.PSW = 0xFF; // NVPHIZC = 1111_1111

    apu.aram[pc + 0] = 0xE0; // CLRV

    apu.smp.PC = pc;
    apu.step(4);

    const psw = apu.smp.PSW & 0xff;
    // Expect V=0 (bit6), H=0 (bit3), others remain 1
    // Bits: N(7)=1, V(6)=0, P(5)=1, B(4)=1, H(3)=0, I(2)=1, Z(1)=1, C(0)=1
    expect(psw).toBe((1<<7) | (0<<6) | (1<<5) | (1<<4) | (0<<3) | (1<<2) | (1<<1) | (1<<0));
  });
});

