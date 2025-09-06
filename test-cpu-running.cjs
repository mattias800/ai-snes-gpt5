#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Import modules
const loader = require('./dist/cart/loader.js');
const header = require('./dist/cart/header.js');
const cartridge = require('./dist/cart/cartridge.js');
const core = require('./dist/emulator/core.js');
const scheduler = require('./dist/emulator/scheduler.js');

const ROM_PATH = 'test-roms/snes-tests/cputest/cputest-full.sfc';

// Load ROM
console.log('Loading ROM:', ROM_PATH);
const raw = fs.readFileSync(ROM_PATH);
const { rom } = loader.normaliseRom(new Uint8Array(raw));
const hdr = header.parseHeader(rom);
const cart = new cartridge.Cartridge({ rom, mapping: hdr.mapping });
const emu = core.Emulator.fromCartridge(cart);

console.log('ROM loaded, mapping:', hdr.mapping);
console.log('ROM size:', rom.length, 'bytes');

// Reset and get CPU
emu.reset();
const cpu = emu.cpu;

// Run for a limited number of cycles and track PC
console.log('Running CPU for a bit...');
const pcHistory = [];
let lastPC = 0;

const sched = new scheduler.Scheduler(emu, 1000, { onCpuError: 'throw' });

try {
  // Run for 1 frame
  sched.stepFrame();
  
  // Check if NMI is enabled
  const bus = emu.bus;
  const nmiEnabled = bus.isNMIEnabled ? bus.isNMIEnabled() : 'unknown';
  console.log('NMI enabled:', nmiEnabled);
  
  // Check PPU state
  const ppu = bus.getPPU();
  console.log('PPU scanline:', ppu.scanline);
  
} catch (e) {
  console.log('Error during execution:', e.message);
  console.log('Stack:', e.stack);
}

console.log('Done');
