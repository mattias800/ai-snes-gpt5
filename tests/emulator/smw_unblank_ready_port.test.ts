import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { normaliseRom } from '../../src/cart/loader';
import { parseHeader } from '../../src/cart/header';
import { Cartridge } from '../../src/cart/cartridge';
import { Emulator } from '../../src/emulator/core';
import { Scheduler } from '../../src/emulator/scheduler';

const ROM_ENV = 'SMW_ROM';

function boot(romPath: string): Emulator {
  const raw = fs.readFileSync(romPath);
  const { rom } = normaliseRom(new Uint8Array(raw));
  const header = parseHeader(rom);
  const cart = new Cartridge({ rom, mapping: header.mapping });
  const emu = Emulator.fromCartridge(cart);
  emu.reset();
  return emu;
}

// Run only when:
//  - SMW_ROM present
//  - SMW_APU_SHIM=1
//  - ONLY_HANDSHAKE=1, UNBLANK=0, TILE=0
//  - READY_PORT in {1,2,3}
//  - READY_VALUE set (0..255)
const readyPort = Number(process.env.SMW_APU_SHIM_READY_PORT ?? '-1');
const readyValSet = process.env.SMW_APU_SHIM_READY_VALUE !== undefined;
const runIf = (process.env[ROM_ENV]
  && (process.env.SMW_APU_SHIM === '1' || process.env.SMW_APU_SHIM === 'true')
  && (process.env.SMW_APU_SHIM_ONLY_HANDSHAKE === '1' || process.env.SMW_APU_SHIM_ONLY_HANDSHAKE === 'true')
  && (process.env.SMW_APU_SHIM_UNBLANK === '0' || process.env.SMW_APU_SHIM_UNBLANK === 'false')
  && (process.env.SMW_APU_SHIM_TILE === '0' || process.env.SMW_APU_SHIM_TILE === 'false')
  && Number.isFinite(readyPort) && readyPort >= 1 && readyPort <= 3 && readyValSet) ? describe : describe.skip;

runIf('SMW unblank with shim READY_PORT/READY_VALUE and handshake-only (env-gated)', () => {
  it('brightness rises above zero within N frames after ready-on-port', () => {
    const emu = boot(process.env[ROM_ENV]!);
    const ips = Number(process.env.SMW_IPS ?? 800);
    const frames = Number(process.env.SMW_FRAMES ?? 600);
    const sched = new Scheduler(emu, Number.isFinite(ips) ? ips : 800, { onCpuError: 'throw' });

    // Deterministic Start press
    emu.bus.setController1State({ Start: true });

    for (let i = 0; i < frames; i++) sched.stepFrame();

    const inidisp = emu.bus.read8(0x00002100);
    expect(inidisp & 0x0f).toBeGreaterThan(0);
  });
});
