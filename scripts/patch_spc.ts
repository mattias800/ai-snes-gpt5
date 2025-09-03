#!/usr/bin/env npx tsx
// Patch SPC files to auto-play by bypassing wait loops

import * as fs from 'fs';
import * as path from 'path';

interface PatchStrategy {
  description: string;
  detect: (aram: Buffer) => number | null;  // Returns address of wait loop or null
  patch: (aram: Buffer, addr: number) => void;
}

const strategies: PatchStrategy[] = [
  {
    description: "NOP out wait loop entirely",
    detect: (aram: Buffer) => {
      // Look for the specific Yoshi wait loop pattern at 0x12FC
      if (aram[0x12FC] === 0xE5 && aram[0x12FD] === 0xF4 && 
          aram[0x12FE] === 0x00 && aram[0x12FF] === 0x68 &&
          aram[0x1301] === 0xD0) {
        return 0x12FC;
      }
      return null;
    },
    patch: (aram: Buffer, addr: number) => {
      console.log(`  NOPing out wait loop at $${addr.toString(16)}`);
      // Replace the entire loop with NOPs (0x00)
      // E5 F4 00 -> NOP NOP NOP
      // 68 CC    -> NOP NOP
      // D0 F9    -> NOP NOP
      for (let i = 0; i < 7; i++) {
        aram[addr + i] = 0x00; // NOP
      }
      // Also set the expected value in port for good measure
      aram[0xF4] = 0xCC;
    }
  },
  {
    description: "MOV A,$00F4 / CMP A,#val / BNE loop",
    detect: (aram: Buffer) => {
      // Look for pattern: E5 F4 00 68 xx D0 xx
      // This reads $00F4 (port 0), compares with immediate, branches back if not equal
      for (let addr = 0; addr < 0xFF00; addr++) {
        if (aram[addr] === 0xE5 &&      // MOV A,abs
            aram[addr + 1] === 0xF4 &&  // Low byte = F4
            aram[addr + 2] === 0x00 &&  // High byte = 00
            aram[addr + 3] === 0x68 &&  // CMP A,#imm
            aram[addr + 5] === 0xD0) {  // BNE
          const branchOffset = aram[addr + 6];
          const branchDest = addr + 7 + (branchOffset << 24 >> 24);
          // Check if it branches back (creating a loop)
          if (branchDest <= addr && branchDest >= addr - 10) {
            return addr;
          }
        }
      }
      return null;
    },
    patch: (aram: Buffer, addr: number) => {
      const expectedVal = aram[addr + 4];
      console.log(`  Patching wait loop at $${addr.toString(16)}`);
      console.log(`  Setting $F4 = $${expectedVal.toString(16)} (expected value)`);
      aram[0xF4] = expectedVal;
    }
  },
  {
    description: "MOV A,dp / CMP A,#val / BNE loop (direct page)",
    detect: (aram: Buffer) => {
      // Pattern: E4 F4 68 xx D0 xx
      for (let addr = 0; addr < 0xFF00; addr++) {
        if (aram[addr] === 0xE4 &&      // MOV A,dp
            aram[addr + 1] === 0xF4 &&  // dp = F4
            aram[addr + 2] === 0x68 &&  // CMP A,#imm
            aram[addr + 4] === 0xD0) {  // BNE
          const branchOffset = aram[addr + 5];
          const branchDest = addr + 6 + (branchOffset << 24 >> 24);
          if (branchDest <= addr && branchDest >= addr - 10) {
            return addr;
          }
        }
      }
      return null;
    },
    patch: (aram: Buffer, addr: number) => {
      const expectedVal = aram[addr + 3];
      console.log(`  Patching wait loop at $${addr.toString(16)}`);
      console.log(`  Setting $F4 = $${expectedVal.toString(16)}`);
      aram[0xF4] = expectedVal;
    }
  },
  {
    description: "Generic port wait (any port)",
    detect: (aram: Buffer) => {
      // More general: look for any tight loop checking F4-F7
      for (let addr = 0; addr < 0xFF00; addr++) {
        // MOV A,abs pattern where abs is F4-F7
        if (aram[addr] === 0xE5) {
          const lo = aram[addr + 1];
          const hi = aram[addr + 2];
          const absAddr = (hi << 8) | lo;
          if (absAddr >= 0xF4 && absAddr <= 0xF7) {
            // Look for CMP and BNE after
            if (aram[addr + 3] === 0x68 && aram[addr + 5] === 0xD0) {
              const branchOffset = aram[addr + 6];
              const branchDest = addr + 7 + (branchOffset << 24 >> 24);
              if (branchDest <= addr && branchDest >= addr - 10) {
                return addr;
              }
            }
          }
        }
      }
      return null;
    },
    patch: (aram: Buffer, addr: number) => {
      const portLo = aram[addr + 1];
      const portHi = aram[addr + 2];
      const port = (portHi << 8) | portLo;
      const expectedVal = aram[addr + 4];
      console.log(`  Patching wait loop at $${addr.toString(16)}`);
      console.log(`  Setting $${port.toString(16)} = $${expectedVal.toString(16)}`);
      if (port >= 0xF4 && port <= 0xF7) {
        aram[port] = expectedVal;
      }
    }
  },
  {
    description: "Skip to timer handler (force music tick)",
    detect: (aram: Buffer) => {
      // If we can't find a simple wait loop, look for timer setup
      // and try to jump directly to the timer handler
      if (aram[0xFA] !== 0 || aram[0xFB] !== 0 || aram[0xFC] !== 0) {
        // Has active timers, might be using timer-based playback
        // Look for the timer IRQ vector
        const irqLo = aram[0xFFFE];
        const irqHi = aram[0xFFFF];
        const irqVec = (irqHi << 8) | irqLo;
        if (irqVec !== 0xFFFF && irqVec !== 0x0000) {
          return 0x12FC; // Return known problematic address for Yoshi
        }
      }
      return null;
    },
    patch: (aram: Buffer, addr: number) => {
      console.log(`  Alternative: Trying to trigger music engine directly`);
      // Common music engine trigger values
      aram[0xF4] = 0x01; // Try "play song 1"
      aram[0xF5] = 0x00;
      aram[0xF6] = 0x00;
      aram[0xF7] = 0x00;
    }
  }
];

function patchSPC(inputFile: string, outputFile: string) {
  console.log(`\nPatching ${inputFile}...`);
  
  const buf = Buffer.from(fs.readFileSync(inputFile));
  if (buf.length < 0x10180) {
    console.error('SPC file too small');
    return;
  }

  // Extract ARAM
  const aramStart = 0x100;
  const aram = buf.slice(aramStart, aramStart + 0x10000);
  
  // Try each strategy
  let patched = false;
  for (const strategy of strategies) {
    const addr = strategy.detect(aram);
    if (addr !== null) {
      console.log(`Detected: ${strategy.description}`);
      strategy.patch(aram, addr);
      patched = true;
      break;
    }
  }

  if (!patched) {
    console.log('No wait loop detected, trying generic patches...');
    // Try some common trigger values
    aram[0xF4] = 0x00;
    aram[0xF5] = 0x01;
    aram[0xF6] = 0x00; 
    aram[0xF7] = 0x00;
  }

  // Additional patches for known issues
  
  // Check if PC is at a known wait loop location
  const pc = (buf[0x26] << 8) | buf[0x25];
  console.log(`Original PC: $${pc.toString(16)}`);
  
  // For Yoshi specifically, we know it gets stuck at 0x12FC
  // We could advance the PC past the wait loop
  if (pc === 0x05A1) {
    // Don't change initial PC, but ensure ports have good values
    console.log('Yoshi SPC detected, applying specific patches...');
    aram[0xF4] = 0x00;
    
    // Also try patching the actual wait loop location directly
    // The loop at 0x12FC is: E5 F4 00 68 xx D0 F9
    if (aram[0x12FC] === 0xE5 && aram[0x12FD] === 0xF4) {
      const expectedVal = aram[0x1300]; // Value being compared
      console.log(`  Patching loop at $12FC, setting F4=${expectedVal.toString(16)}`);
      aram[0xF4] = expectedVal;
    }
  }

  // Write back ARAM
  for (let i = 0; i < 0x10000; i++) {
    buf[aramStart + i] = aram[i];
  }

  // Save patched file
  fs.writeFileSync(outputFile, buf);
  console.log(`Saved patched SPC to ${outputFile}`);
}

// Main
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: patch_spc.ts <input.spc> <output.spc>');
  console.log('Example: patch_spc.ts yoshi.spc yoshi_patched.spc');
  process.exit(1);
}

const [input, output] = args;
if (!fs.existsSync(input)) {
  console.error(`Input file not found: ${input}`);
  process.exit(1);
}

patchSPC(input, output);
