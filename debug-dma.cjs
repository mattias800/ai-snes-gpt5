#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { normaliseRom } = require('./dist/cart/loader');
const { parseHeader } = require('./dist/cart/header');
const { Cartridge } = require('./dist/cart/cartridge');
const { Emulator } = require('./dist/emulator/core');
const { Scheduler } = require('./dist/emulator/scheduler');

const ROM_PATH = 'test-roms/snes-tests/cputest/cputest-full.sfc';

// Load ROM
const raw = fs.readFileSync(ROM_PATH);
const { rom } = normaliseRom(new Uint8Array(raw));
const header = parseHeader(rom);
const cart = new Cartridge({ rom, mapping: header.mapping });
const emu = Emulator.fromCartridge(cart);
emu.reset();

console.log('ROM loaded, mapping:', header.mapping);
console.log('ROM size:', rom.length, 'bytes');

// Check the data at some key offsets
console.log('ROM data at 0xCD2A:', rom[0xCD2A].toString(16).padStart(2,'0'));
console.log('ROM data at 0xCD2C:', rom[0xCD2C].toString(16).padStart(2,'0'));
console.log('ROM data at 0xCD35:', rom[0xCD35].toString(16).padStart(2,'0'));
console.log('ROM data at 0xCD37:', rom[0xCD37].toString(16).padStart(2,'0'));

const sched = new Scheduler(emu, 1000, { onCpuError: 'throw' });
const ppu = emu.bus.getPPU();

// Run for a few frames
console.log('Running emulation for 60 frames...');
for (let f = 0; f < 60; f++) {
  try {
    sched.stepFrame();
  } catch (e) {
    console.log('Error at frame', f, ':', e.message);
    break;
  }
}

// Check VRAM
let nonZeroAt4000 = 0;
for (let i = 0; i < 256; i++) {
  const word = ppu.inspectVRAMWord(0x4000 + i) & 0xffff;
  if (word !== 0) nonZeroAt4000++;
}

console.log('Non-zero words at VRAM $4000:', nonZeroAt4000);

// Sample some VRAM
console.log('Sample VRAM at $4000:');
for (let i = 0; i < 8; i++) {
  const word = ppu.inspectVRAMWord(0x4000 + i) & 0xffff;
  console.log(`  [${(0x4000 + i).toString(16)}] = 0x${word.toString(16).padStart(4, '0')}`);
}
