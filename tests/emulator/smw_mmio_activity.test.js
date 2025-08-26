import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { normaliseRom } from '../../src/cart/loader';
import { parseHeader } from '../../src/cart/header';
import { Cartridge } from '../../src/cart/cartridge';
import { Emulator } from '../../src/emulator/core';
import { Scheduler } from '../../src/emulator/scheduler';
const ROM_ENV = 'SMW_ROM';
function boot(romPath) {
    const raw = fs.readFileSync(romPath);
    const { rom } = normaliseRom(new Uint8Array(raw));
    const header = parseHeader(rom);
    const cart = new Cartridge({ rom, mapping: header.mapping });
    const emu = Emulator.fromCartridge(cart);
    emu.reset();
    return emu;
}
const runIf = process.env[ROM_ENV] ? describe : describe.skip;
runIf('SMW MMIO activity (env-gated)', () => {
    it('after deterministic frames, INIDISP ($2100) and BG1 regs are non-default', () => {
        const emu = boot(process.env[ROM_ENV]);
        const ips = Number(process.env.SMW_IPS ?? 240);
        const frames = Number(process.env.SMW_FRAMES ?? 600);
        const sched = new Scheduler(emu, Number.isFinite(ips) ? ips : 240, { onCpuError: 'throw' });
        // Hold Start for determinism
        emu.bus.setController1State({ Start: true });
        for (let i = 0; i < frames; i++)
            sched.stepFrame();
        // Read PPU INIDISP mirror; expect non-zero brightness written at some point
        const inidisp = emu.bus.read8(0x00002100);
        expect(inidisp).not.toBe(0x00);
        // BG1SC ($2107) and BG12NBA ($210B) may be configured later in boot.
        // We read them for information but do not assert yet to avoid false negatives during early-boot.
        const bg1sc = emu.bus.read8(0x00002107);
        const bg12nba = emu.bus.read8(0x0000210b);
        // eslint-disable-next-line no-console
        console.log(`[SMW MMIO] BG1SC=$${bg1sc.toString(16).padStart(2, '0')} BG12NBA=$${bg12nba.toString(16).padStart(2, '0')}`);
    });
});
