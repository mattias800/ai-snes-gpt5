import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';

const cpuPort = (idx: number) => (0x00 << 16) | (0x2140 + (idx & 3));

function mkBus() {
  const rom = new Uint8Array(0x20000);
  const cart = new Cartridge({ rom, mapping: 'lorom' });
  return new SNESBus(cart);
}

describe('Bus<->APUDevice mailbox bridge with real APU enabled', () => {
  const savedEnv: Record<string, string | undefined> = {};
  function setEnv(k: string, v: string | undefined) {
    if (!(k in savedEnv)) savedEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  function restoreEnv() {
    for (const k of Object.keys(savedEnv)) {
      const v = savedEnv[k];
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }

  beforeEach(() => {
    setEnv('APU_SPC700_MODE', 'core');
    setEnv('APU_SPC700_CORE', '1');
  });
  afterEach(() => restoreEnv());

  it('CPU→APU: writing $2140-$2143 is visible to APU at $F4-$F7', () => {
    const bus = mkBus();
    const apu = bus.getAPUDevice();
    expect(apu).not.toBeNull();
    // CPU writes to $2142
    bus.write8(cpuPort(2), 0x77);
    // APU side sees it at $F6
    const seen = (apu as any).read8(0x00f6) & 0xff;
    expect(seen).toBe(0x77);
  });

  it('APU→CPU: APU write to $F7 shows up at CPU $2143', () => {
    const bus = mkBus();
    const apu = bus.getAPUDevice();
    expect(apu).not.toBeNull();
    // APU writes to its outgoing port
    (apu as any).write8(0x00f7, 0xa5);
    // CPU reads from $2143
    const cpuRead = bus.read8(cpuPort(3));
    expect(cpuRead).toBe(0xa5);
  });
});
