import { describe, it, expect } from 'vitest';
import { APUDevice } from '../../src/apu/apu';

describe('APUDevice CPU/APU mailbox ports bridge', () => {
  it('CPU→APU: cpuWritePort propagates to APU-side read at $F4-$F7', () => {
    const apu: any = new APUDevice();
    // CPU writes to $2142 -> APU sees at $F6
    apu.cpuWritePort(2, 0x5a);
    const seen = apu.read8(0x00f6);
    expect(seen).toBe(0x5a);
  });

  it('APU→CPU: APU write to $F7 shows up at CPU $2143', () => {
    const apu: any = new APUDevice();
    // APU writes value to its outgoing port (apuToCpu[3])
    apu.write8(0x00f7, 0xa5);
    const cpuRead = apu.cpuReadPort(3);
    expect(cpuRead).toBe(0xa5);
  });
});
