import * as fs from 'fs';
import { normaliseRom } from './src/cart/loader.js';
import { parseHeader } from './src/cart/header.js';
import { Cartridge } from './src/cart/cartridge.js';
import { Emulator } from './src/emulator/core.js';
import { Scheduler } from './src/emulator/scheduler.js';

const ROM_PATH = './test-roms/snes-tests/cputest/cputest-full.sfc';

// Load ROM
const raw = fs.readFileSync(ROM_PATH);
const { rom } = normaliseRom(new Uint8Array(raw));
console.log(`ROM size: 0x${rom.length.toString(16)} bytes`);
const header = parseHeader(rom);
const cart = new Cartridge({ rom, mapping: header.mapping });

// Create emulator
const emu = Emulator.fromCartridge(cart);
emu.reset();

// Create scheduler
const sched = new Scheduler(emu, 1000, { onCpuError: 'throw' });
const bus = emu.bus as any;

// Hook DMA register writes
const origWrite = bus.mapWrite.bind(bus);
let dmaSetupStarted = false;

bus.mapWrite = function(addr: number, value: number): void {
  const off = addr & 0xffff;
  
  // Track DMA channel 0 register writes
  if (off >= 0x4300 && off <= 0x4307) {
    const reg = off & 0xf;
    const names = ['DMAP', 'BBAD', 'A1TL', 'A1TH', 'A1B', 'DASL', 'DASH'];
    console.log(`DMA ch0 ${names[reg] || `reg${reg}`} <- $${value.toString(16).padStart(2, '0')}`);
    dmaSetupStarted = true;
  }
  
  // When DMA is triggered, show final state
  if (off === 0x420b && value !== 0 && dmaSetupStarted) {
    console.log('\nDMA triggered! Final ch0 state:');
    console.log(`  DMAP: $${bus.dmap[0].toString(16).padStart(2, '0')}`);
    console.log(`  BBAD: $${bus.bbad[0].toString(16).padStart(2, '0')}`);
    console.log(`  A1T: $${bus.a1tl[0].toString(16).padStart(4, '0')}`);
    console.log(`  A1B: $${bus.a1b[0].toString(16).padStart(2, '0')}`);
    console.log(`  DAS: $${(bus.das[0] || 0x10000).toString(16)}`);
    console.log('');
    dmaSetupStarted = false;
  }
  
  origWrite(addr, value);
};

// Run emulation until first DMA
console.log('Running emulation until DMA...\n');
for (let frame = 0; frame < 10; frame++) {
  sched.stepFrame();
  if (bus.das[0] === 0) { // DMA completed
    console.log('First DMA completed');
    break;
  }
}
