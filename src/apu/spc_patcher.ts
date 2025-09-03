// SPC patcher to fix common wait loops that prevent music playback

export function patchSpcWaitLoops(aram: Uint8Array): number {
  let patchCount = 0;
  
  // Pattern 1: MOV A,$F4 / CMP A,#xx / BNE (waiting for port 0)
  for (let addr = 0; addr < 0xFF00; addr++) {
    if (aram[addr] === 0xE4 && aram[addr + 1] === 0xF4 &&     // MOV A,$F4
        aram[addr + 2] === 0x68 &&                             // CMP A,#xx
        aram[addr + 4] === 0xD0) {                             // BNE
      const branchOffset = aram[addr + 5];
      const branchDest = addr + 6 + (branchOffset << 24 >> 24);
      
      // Check if it branches backwards (loop)
      if (branchDest <= addr && branchDest >= addr - 20) {
        console.log(`Patching wait loop at 0x${addr.toString(16)}`);
        // Replace with NOPs
        for (let i = 0; i < 6; i++) {
          aram[addr + i] = 0x00; // NOP
        }
        patchCount++;
      }
    }
  }
  
  // Pattern 2: Simple BPL/BMI/BNE tight loops
  for (let addr = 0; addr < 0xFF00; addr++) {
    const op = aram[addr];
    if (op === 0x10 || op === 0x30 || op === 0xD0) { // BPL, BMI, BNE
      const offset = aram[addr + 1];
      const dest = addr + 2 + (offset << 24 >> 24);
      
      // Very tight loop (branches to itself or very close)
      if (dest >= addr - 4 && dest <= addr) {
        console.log(`Patching tight loop at 0x${addr.toString(16)}`);
        aram[addr] = 0x00;     // NOP
        aram[addr + 1] = 0x00; // NOP
        patchCount++;
      }
    }
  }
  
  // Pattern 3: Communication handshake loops
  // MOV A,$F4 / MOV $xx,A / MOV A,$F5 / ... / BPL/BNE back
  for (let addr = 0x500; addr < 0x2000; addr++) {
    if (aram[addr] === 0xE4 && aram[addr + 1] === 0xF4) { // MOV A,$F4
      // Look ahead for a branch back
      for (let i = 2; i < 20; i++) {
        const op = aram[addr + i];
        if (op === 0x10 || op === 0xD0) { // BPL or BNE
          const offset = aram[addr + i + 1];
          const dest = addr + i + 2 + (offset << 24 >> 24);
          if (dest === addr) {
            console.log(`Patching comm loop at 0x${addr.toString(16)}`);
            // Patch the branch to continue instead of loop
            aram[addr + i] = 0x00;     // NOP
            aram[addr + i + 1] = 0x00; // NOP
            patchCount++;
            break;
          }
        }
      }
    }
  }
  
  return patchCount;
}

// Inject periodic timer triggers to help music advance
export function injectTimerTrigger(aram: Uint8Array, addr: number): void {
  // Simple timer trigger: INC $FD (increment timer 0 counter)
  // This can help some music drivers that poll timers
  
  if (addr < 0xFF00) {
    // MOV A,$FD
    aram[addr] = 0xE4;
    aram[addr + 1] = 0xFD;
    // INC A
    aram[addr + 2] = 0xBC;
    // MOV $FD,A
    aram[addr + 3] = 0xC4;
    aram[addr + 4] = 0xFD;
    // RET
    aram[addr + 5] = 0x6F;
  }
}
