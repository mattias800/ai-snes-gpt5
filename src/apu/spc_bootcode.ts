// SPC boot code builder for restoring state from snapshot
// Based on the reference implementation from spc-player

export class SpcBootCode {
  private code: number[] = [];
  
  // Build boot code that will restore SPC state
  build(
    cpuRegs: {
      pc: number;
      a: number;
      x: number;
      y: number;
      sp: number;
      psw: number;
    },
    ioRegs: {
      f1: number;  // control
      fa: number;  // timer 0 target
      fb: number;  // timer 1 target
      fc: number;  // timer 2 target
    }
  ): Uint8Array {
    this.code = [];
    
    // The boot code will:
    // 1. Restore timer targets
    // 2. Restore control register
    // 3. Wait for specific port values
    // 4. Restore DSP registers (already done separately)
    // 5. Set up stack for RETI
    // 6. Load CPU registers
    // 7. Execute RETI to jump to saved PC with saved state
    
    // MOV [00h],#00h - clear first two bytes (used by IPL)
    this.emit(0x8F, 0x00, 0x00);
    this.emit(0x8F, 0x00, 0x01);
    
    // MOV [0FCh],#timer2_target
    this.emit(0x8F, ioRegs.fc & 0xFF, 0xFC);
    
    // MOV [0FBh],#timer1_target
    this.emit(0x8F, ioRegs.fb & 0xFF, 0xFB);
    
    // MOV [0FAh],#timer0_target
    this.emit(0x8F, ioRegs.fa & 0xFF, 0xFA);
    
    // MOV [0F1h],#control
    this.emit(0x8F, ioRegs.f1 & 0xFF, 0xF1);
    
    // MOV X,#23h (acknowledgement byte)
    this.emit(0xCD, 0x23);
    
    // MOV [0F5h],X (send ack to port 1)
    this.emit(0xD8, 0xF5);
    
    // Wait for port 0 = 01h and port 3 = 00h
    // IN0: MOV A,[0F4h]
    this.emit(0xE4, 0xF4);
    // CMP A,#01h
    this.emit(0x68, 0x01);
    // BNE IN0
    this.emit(0xD0, 0xFA);
    
    // IN3: MOV A,[0F7h]
    this.emit(0xE4, 0xF7);
    // CMP A,#00h
    this.emit(0x68, 0x00);
    // BNE IN3
    this.emit(0xD0, 0xFA);
    
    // Clear echo buffer control (disable echo temporarily)
    // MOV [0F2h],#6Ch (FLG register)
    this.emit(0x8F, 0x6C, 0xF2);
    // MOV [0F3h],#00h (clear FLG)
    this.emit(0x8F, 0x00, 0xF3);
    
    // Clear KON register
    // MOV [0F2h],#4Ch
    this.emit(0x8F, 0x4C, 0xF2);
    // MOV [0F3h],#00h
    this.emit(0x8F, 0x00, 0xF3);
    
    // Reset DSP (will be restored separately)
    // MOV [0F2h],#7Fh (ENDX register)
    this.emit(0x8F, 0x7F, 0xF2);
    
    // Set up stack pointer
    // MOV X,#sp
    this.emit(0xCD, cpuRegs.sp & 0xFF);
    // MOV SP,X
    this.emit(0xBD);
    
    // Push PC and PSW onto stack for RETI
    // The stack grows downward, so we need to set up the stack
    // with PSW at SP-2, PCH at SP-1, PCL at SP
    
    // First adjust SP to point to where we'll place the return address
    const adjustedSp = (cpuRegs.sp - 2) & 0xFF;
    
    // Store PSW, PCH, PCL on stack
    // MOV [01xxh],#psw (at SP-2)
    const pswAddr = 0x0100 + ((adjustedSp) & 0xFF);
    this.emit(0x8F, cpuRegs.psw & 0xFF, pswAddr & 0xFF);
    
    // MOV [01xxh],#pch (at SP-1)
    const pchAddr = 0x0100 + ((adjustedSp + 1) & 0xFF);
    this.emit(0x8F, (cpuRegs.pc >> 8) & 0xFF, pchAddr & 0xFF);
    
    // MOV [01xxh],#pcl (at SP)
    const pclAddr = 0x0100 + ((adjustedSp + 2) & 0xFF);
    this.emit(0x8F, cpuRegs.pc & 0xFF, pclAddr & 0xFF);
    
    // Set correct SP for RETI
    this.emit(0xCD, adjustedSp);
    this.emit(0xBD);
    
    // Load A, X, Y registers
    // MOV A,#a_value
    this.emit(0xE8, cpuRegs.a & 0xFF);
    // MOV X,#x_value
    this.emit(0xCD, cpuRegs.x & 0xFF);
    // MOV Y,#y_value
    this.emit(0x8D, cpuRegs.y & 0xFF);
    
    // RETI - return from interrupt, popping PSW and PC from stack
    this.emit(0x7F);
    
    return new Uint8Array(this.code);
  }
  
  private emit(...bytes: number[]) {
    for (const b of bytes) {
      this.code.push(b & 0xFF);
    }
  }
  
  getSize(): number {
    return this.code.length;
  }
}
