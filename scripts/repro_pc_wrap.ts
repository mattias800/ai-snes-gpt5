#!/usr/bin/env tsx
import fs from 'fs';
import { Cartridge } from '../src/cart/cartridge.js';
import { Emulator } from '../src/emulator/core.js';
import { normaliseRom } from '../src/cart/loader.js';

function log(label: string, emu: Emulator) {
  const s = emu.cpu.state;
  const pad = (n: number, w: number) => n.toString(16).toUpperCase().padStart(w, '0');
  console.log(`${label}: PBR=${pad(s.PBR,2)} PC=${pad(s.PC,4)} P=${pad(s.P,2)} E=${s.E?1:0}`);
}

async function main() {
  const raw = fs.readFileSync('test-roms/snes-tests/cputest/cputest-basic.sfc');
  const { rom } = normaliseRom(new Uint8Array(raw));
  const emu = Emulator.fromCartridge(new Cartridge({ rom }));
  emu.reset();

  // Place NOP ($EA) at 7E:FFFF, and $00 at 7F:0000 to see wrap target
  emu.bus.write8(0x7EFFFF, 0xEA);
  emu.bus.write8(0x7F0000, 0xA9); // LDA #imm to make it obvious next opcode isn't NOP

  // Set CPU to native mode (E=0), P flags: clear M and X for 16-bit? Irrelevant for NOP
  emu.cpu.state.E = false;
  // Ensure M/X unchanged; NOP doesn't care

  // Jump to 7E:FFFF
  emu.cpu.state.PBR = 0x7E;
  emu.cpu.state.PC = 0xFFFF;

  log('Before', emu);
  emu.stepInstruction();
  log('After1', emu);
  emu.stepInstruction();
  log('After2', emu);
}

main().catch(e => { console.error(e); process.exit(1); });

