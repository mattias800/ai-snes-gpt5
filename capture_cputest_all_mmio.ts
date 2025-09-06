import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { normaliseRom } from './src/cart/loader';
import { parseHeader } from './src/cart/header';
import { Cartridge } from './src/cart/cartridge';
import { Emulator } from './src/emulator/core';
import { Scheduler } from './src/emulator/scheduler';
import { renderMainScreenRGBA } from './src/ppu/bg';

// Enable MMIO logging WITHOUT filter to see ALL writes
process.env.SMW_LOG_MMIO = '1';
process.env.SMW_LOG_LIMIT = '200';
// No filter set - see everything

// Boot the ROM
const romPath = 'test-roms/snes-tests/cputest/cputest-full.sfc';
const raw = fs.readFileSync(romPath);
const { rom } = normaliseRom(new Uint8Array(raw));
const header = parseHeader(rom);
const cart = new Cartridge({ rom, mapping: header.mapping });
const emu = Emulator.fromCartridge(cart);
emu.reset();

// Create scheduler
const sched = new Scheduler(emu, 1000, { onCpuError: 'throw' });

// Run just a few frames to see initial MMIO activity
console.log('Running cputest-full.sfc to see initial MMIO activity...\n');
for (let i = 0; i < 3; i++) {
  console.log(`=== Frame ${i} ===`);
  sched.stepFrame();
}

console.log('\nDone - check above for VRAM address setup before DMA');
