import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { normaliseRom } from '../../src/cart/loader';
import { parseHeader } from '../../src/cart/header';
import { Cartridge } from '../../src/cart/cartridge';
import { Emulator } from '../../src/emulator/core';
import { Scheduler } from '../../src/emulator/scheduler';

function boot(romPath: string): Emulator {
  const raw = fs.readFileSync(romPath);
  const { rom } = normaliseRom(new Uint8Array(raw));
  const header = parseHeader(rom);
  const cart = new Cartridge({ rom, mapping: header.mapping });
  const emu = Emulator.fromCartridge(cart);
  emu.reset();
  return emu;
}

const ROM_ENV = 'SMW_ROM';

// Run only if:
// - ROM present
// - Shim enabled
// - ONLY_HANDSHAKE=1, TILE=0, UNBLANK=0, ECHO_PORTS=1
const shouldRun = !!process.env[ROM_ENV]
  && (process.env.SMW_APU_SHIM === '1' || process.env.SMW_APU_SHIM === 'true')
  && (process.env.SMW_APU_SHIM_ONLY_HANDSHAKE === '1' || process.env.SMW_APU_SHIM_ONLY_HANDSHAKE === 'true')
  && (process.env.SMW_APU_SHIM_UNBLANK === '0' || process.env.SMW_APU_SHIM_UNBLANK === 'false')
  && (process.env.SMW_APU_SHIM_TILE === '0' || process.env.SMW_APU_SHIM_TILE === 'false')
  && (process.env.SMW_APU_SHIM_ECHO_PORTS === '1' || process.env.SMW_APU_SHIM_ECHO_PORTS === 'true');

const runIf = shouldRun ? describe : describe.skip;

runIf('SMW progress activity (env-gated, handshake-only, no injection)', () => {
  it('non-zero CGRAM/VRAM content increases across frame checkpoints', () => {
    const romPath = process.env[ROM_ENV]!;
    const emu = boot(romPath);
    const ips = Number(process.env.SMW_IPS ?? 800);
    const sched = new Scheduler(emu, Number.isFinite(ips) ? ips : 800, { onCpuError: 'throw' });

    // Select checkpoints in frames
    const checkpoints = [120, 360, 600];
    let curFrame = 0;

    function stepTo(frame: number) {
      while (curFrame < frame) { sched.stepFrame(); curFrame++; }
    }

    function countCGRAMNonZero() {
      const ppu = emu.bus.getPPU();
      let c = 0; for (let i = 1; i < 256; i++) if (ppu.inspectCGRAMWord(i) !== 0) c++;
      return c;
    }
    function countVRAMNonZero(limitWords = 0x2000) {
      const ppu = emu.bus.getPPU();
      let c = 0; for (let a = 0; a < limitWords; a++) if (ppu.inspectVRAMWord(a) !== 0) { c++; if (c > 8) break; }
      return c;
    }

    const c0 = countCGRAMNonZero();
    const v0 = countVRAMNonZero();

    // Simulate Start pressed for determinism
    emu.bus.setController1State({ Start: true });

    stepTo(checkpoints[0]);
    const c1 = countCGRAMNonZero();
    const v1 = countVRAMNonZero();

    stepTo(checkpoints[1]);
    const c2 = countCGRAMNonZero();
    const v2 = countVRAMNonZero();

    stepTo(checkpoints[2]);
    const c3 = countCGRAMNonZero();
    const v3 = countVRAMNonZero();

    // Expect some activity by final checkpoint
    expect(c3 > 0 || v3 > 0).toBe(true);

    // Expect non-decreasing and preferably increasing across checkpoints
    expect(c1 >= c0).toBe(true);
    expect(v1 >= v0).toBe(true);
    expect(c2 >= c1).toBe(true);
    expect(v2 >= v1).toBe(true);
    expect(c3 >= c2).toBe(true);
    expect(v3 >= v2).toBe(true);
  });
});
