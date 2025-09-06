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
const header = parseHeader(rom);
const cart = new Cartridge({ rom, mapping: header.mapping });

// Create emulator
const emu = Emulator.fromCartridge(cart);
emu.reset();

// Create scheduler
const sched = new Scheduler(emu, 1000, { onCpuError: 'throw' });
const ppu = emu.bus.getPPU() as any;
const bus = emu.bus as any;

// Hook the MDMAEN write to see DMA params
const origWrite = bus.mapWrite.bind(bus);
let dmaCount = 0;

bus.mapWrite = function(addr: number, value: number): void {
  const off = addr & 0xffff;
  if (off === 0x420b && value !== 0) {
    dmaCount++;
    console.log(`\nDMA #${dmaCount}:`);
    
    // Check what channel is being used
    for (let ch = 0; ch < 8; ch++) {
      if ((value & (1 << ch)) !== 0) {
        const dmap = bus.dmap[ch];
        const bbad = bus.bbad[ch];
        const a1tl = bus.a1tl[ch];
        const a1b = bus.a1b[ch];
        const das = bus.das[ch] || 0x10000;
        
        console.log(`  Channel ${ch}:`);
        console.log(`    DMAP=$${dmap.toString(16).padStart(2,'0')} BBAD=$${bbad.toString(16).padStart(2,'0')}`);
        console.log(`    Source: $${a1b.toString(16).padStart(2,'0')}:${a1tl.toString(16).padStart(4,'0')}`);
        console.log(`    Count: $${das.toString(16)} bytes`);
        
        // Check first few bytes at source
        const srcAddr = (a1b << 16) | a1tl;
        console.log(`    First bytes from source:`);
        for (let i = 0; i < Math.min(16, das); i++) {
          const byte = bus.read8(srcAddr + i);
          process.stdout.write(` ${byte.toString(16).padStart(2,'0')}`);
        }
        console.log('');
      }
    }
  }
  origWrite(addr, value);
};

// Run for a few frames
console.log('Running emulation...');
for (let frame = 0; frame < 5; frame++) {
  sched.stepFrame();
}

// Check VRAM for font data
const vram = ppu.vram as Uint16Array;
console.log('\nChecking VRAM for font data...');

// Check char base 0x0
let hasData0 = false;
for (let i = 0; i < 0x1000; i++) {
  if (vram[i] !== 0) {
    hasData0 = true;
    break;
  }
}

// Check char base 0x2000 
let hasData2000 = false;
for (let i = 0x2000; i < 0x3000; i++) {
  if (vram[i] !== 0) {
    hasData2000 = true;
    break;
  }
}

console.log(`Font data at VRAM 0x0: ${hasData0}`);
console.log(`Font data at VRAM 0x2000: ${hasData2000}`);

// Check specific tiles
const tilesExpected = [0x52, 0x75, 0x6e, 0x6e, 0x69, 0x6e, 0x67]; // "Running"
console.log('\nChecking specific font tiles:');
for (const tile of tilesExpected) {
  // Check at base 0x0
  const addr0 = tile * 8;
  let data0 = false;
  for (let j = 0; j < 8; j++) {
    if (vram[addr0 + j] !== 0) {
      data0 = true;
      break;
    }
  }
  
  // Check at base 0x2000
  const addr2000 = 0x2000 + tile * 8;
  let data2000 = false;
  for (let j = 0; j < 8; j++) {
    if (vram[addr2000 + j] !== 0) {
      data2000 = true;
      break;
    }
  }
  
  const char = String.fromCharCode(tile);
  console.log(`  Tile 0x${tile.toString(16)} ('${char}'): base0=${data0}, base2000=${data2000}`);
}

console.log(`\nBG1 char base: 0x${ppu.bg1CharBaseWord.toString(16)}`);
