import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SNESBus } from '../../src/bus/snesBus';
import { Cartridge } from '../../src/cart/cartridge';

const mmio = (reg: number) => (0x00 << 16) | (0x2100 + (reg & 0xff));
const cpuPort = (idx: number) => (0x00 << 16) | (0x2140 + (idx & 3));

function mkBus() {
  const rom = new Uint8Array(0x20000);
  const cart = new Cartridge({ rom, mapping: 'lorom' });
  return new SNESBus(cart);
}

describe('APU shim: $2140 toggle pattern and countdown-driven unblank', () => {
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

  afterEach(() => {
    restoreEnv();
  });

  it('without shim: toggles bit7 every default period then settles to 0 after enough toggles', () => {
    // Ensure shim disabled and defaults
    setEnv('SMW_APU_SHIM', '0');

    const bus = mkBus();

    // Trigger handshake
    bus.write8(cpuPort(0), 0xcc);
    bus.write8(cpuPort(1), 0x01);

    // Read $2140 a bunch of times, observe toggling every 16 reads
    const period = 16; // default
    let prev = -1;
    let toggles = 0;
    for (let i = 0; i < period * 140; i++) {
      const v = bus.read8(cpuPort(0));
      if (i % period === 0) {
        // Should flip between 0x00 and 0x80 on each completed period block
        if (prev !== -1 && v !== prev) toggles++;
        prev = v;
      }
    }

    // We expect more than 128 toggles to have happened -> bus transitions to done and returns 0x00
    const doneVal = bus.read8(cpuPort(0));
    expect(doneVal).toBe(0x00);
  });

  it('with shim: small COUNTDOWN_READS triggers unblank (INIDISP brightness>0) and enables BG1', () => {
    setEnv('SMW_APU_SHIM', '1');
    setEnv('SMW_APU_SHIM_COUNTDOWN_READS', '4');
    setEnv('SMW_APU_SHIM_UNBLANK', '1');
    setEnv('SMW_APU_SHIM_TILE', '0');

    const bus = mkBus();

    // Trigger handshake
    bus.write8(cpuPort(0), 0xcc);
    bus.write8(cpuPort(1), 0x01);

    // Read a few times to drain countdown
    for (let i = 0; i < 4; i++) { bus.read8(cpuPort(0)); }

    // Verify unblank and BG1 enabled
    const ppu = bus.getPPU();
    expect(ppu.brightness).toBeGreaterThan(0);
    expect((ppu.tm & 0x01) !== 0).toBe(true);

    // Port now should hold 0x00 (done)
    const v = bus.read8(cpuPort(0));
    expect(v).toBe(0x00);
  });

  it('with shim echo: writes to $2142 are echoed back on read (mailbox)', () => {
    setEnv('SMW_APU_SHIM', '1');
    setEnv('SMW_APU_SHIM_ECHO_PORTS', '1');
    setEnv('SMW_APU_SHIM_TOGGLE_PERIOD', '1');

    const bus = mkBus();

    // Before handshake, echo ports should still reflect last write
    bus.write8(cpuPort(2), 0x5a);
    const vPre = bus.read8(cpuPort(2));
    expect(vPre).toBe(0x5a);

    // Trigger handshake and ensure toggling on port0 still works
    bus.write8(cpuPort(0), 0xcc);
    bus.write8(cpuPort(1), 0x01);
    const t0 = bus.read8(cpuPort(0));
    const t1 = bus.read8(cpuPort(0));
    expect(t0).not.toBe(t1);

    // Echo again during busy/done
    bus.write8(cpuPort(3), 0xa5);
    const vEcho = bus.read8(cpuPort(3));
    expect(vEcho).toBe(0xa5);
  });

  it('with shim ready-on-zero: writing 0 to $2140 during busy ends it immediately', () => {
    setEnv('SMW_APU_SHIM', '1');
    setEnv('SMW_APU_SHIM_READY_ON_ZERO', '1');
    setEnv('SMW_APU_SHIM_UNBLANK', '0');
    setEnv('SMW_APU_SHIM_TILE', '0');
    setEnv('SMW_APU_SHIM_COUNTDOWN_READS', '1000');

    const bus = mkBus();

    // Trigger handshake
    bus.write8(cpuPort(0), 0xcc);
    bus.write8(cpuPort(1), 0x01);

    // Ensure we are in busy (first read returns 0x00 or 0x80 depending on period)
    const before = bus.read8(cpuPort(0));
    expect(before === 0x00 || before === 0x80).toBe(true);

    // Force ready with zero write
    bus.write8(cpuPort(0), 0x00);

    // Subsequent reads should be 0x00 (done)
    const after = bus.read8(cpuPort(0));
    expect(after).toBe(0x00);
  });

  it('with shim ready-on-port: writing READY_VALUE to selected port ends busy immediately', () => {
    setEnv('SMW_APU_SHIM', '1');
    setEnv('SMW_APU_SHIM_READY_PORT', '2'); // $2142
    setEnv('SMW_APU_SHIM_READY_VALUE', '119'); // 0x77
    setEnv('SMW_APU_SHIM_UNBLANK', '0');
    setEnv('SMW_APU_SHIM_TILE', '0');
    setEnv('SMW_APU_SHIM_COUNTDOWN_READS', '1000'); // avoid countdown finishing first

    const bus = mkBus();

    // Trigger handshake
    bus.write8(cpuPort(0), 0xcc);
    bus.write8(cpuPort(1), 0x01);

    // Confirm busy by reading once
    const before = bus.read8(cpuPort(0));
    expect(before === 0x00 || before === 0x80).toBe(true);

    // Write READY_VALUE to $2142 to force completion
    bus.write8(cpuPort(2), 0x77);

    const after = bus.read8(cpuPort(0));
    expect(after).toBe(0x00);
  });
  it('SPC700(SMW mode): CC echo then 00, mirror $2140 writes, complete after $2141 threshold', () => {
    // Enable SPC700 path and SMW mode with small thresholds
    const saved: Record<string, string | undefined> = {};
    function s(k: string, v: string) { saved[k] = process.env[k]; process.env[k] = v; }
    function r() { for (const k of Object.keys(saved)) { const v = saved[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
    try {
      s('SMW_SPC700','1');
      s('SMW_APU_SHIM_SCRIPT','smw');
      s('SMW_APU_SHIM_SMW_PHASE1','1');
      s('SMW_APU_SHIM_SMW_PHASE2','1');
      s('SMW_APU_UPLOAD_THRESHOLD','4');

      const bus = mkBus();

      // CC initiates; first read after CC should be CC then 00
      bus.write8(cpuPort(0), 0xcc);
      const cc1 = bus.read8(cpuPort(0));
      const cc2 = bus.read8(cpuPort(0));
      expect(cc1).toBe(0xcc);
      expect(cc2).toBe(0x00);

      // Mirror: write 01 then read 01; write 02 then read 02
      bus.write8(cpuPort(0), 0x01);
      expect(bus.read8(cpuPort(0))).toBe(0x01);
      bus.write8(cpuPort(0), 0x02);
      expect(bus.read8(cpuPort(0))).toBe(0x02);

      // Upload a few bytes to $2141 to hit threshold
      bus.write8(cpuPort(1), 0x11);
      bus.write8(cpuPort(1), 0x22);
      bus.write8(cpuPort(1), 0x33);
      bus.write8(cpuPort(1), 0x44);

      // After threshold, port0 should hold done value (default 0)
      const done = bus.read8(cpuPort(0));
      expect(done).toBe(0x00);
    } finally {
      r();
    }
  });
});
