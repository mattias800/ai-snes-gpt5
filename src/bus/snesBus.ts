import { IMemoryBus, Byte, Word } from '../emulator/types';
import { Cartridge } from '../cart/cartridge';
import { PPU } from '../ppu/ppu';
import { Controller, Button } from '../input/controller';

// Partial SNES Bus focusing on ROM, WRAM, MMIO, and basic DMA for tests.
export class SNESBus implements IMemoryBus {
  // 128 KiB WRAM at 0x7E:0000-0x7F:FFFF
  private wram = new Uint8Array(128 * 1024);

  // PPU device handling $2100-$21FF
  private ppu = new PPU();

  // Expose PPU for integration tests and emulator orchestration
  public getPPU(): PPU {
    return this.ppu;
  }

  // Deterministic input helper for tests: set controller 1 state and latch it
  public setController1State(state: Partial<Record<Button, boolean>>): void {
    const order: Button[] = ['B', 'Y', 'Select', 'Start', 'Up', 'Down', 'Left', 'Right', 'A', 'X', 'L', 'R'];
    for (const btn of order) {
      const pressed = !!state[btn];
      this.controller1.setButton(btn, pressed);
    }
    // Strobe to latch and reset shift position
    this.controller1.writeStrobe(1);
    this.controller1.writeStrobe(0);
  }

  // DMA channel registers (8 channels, base $4300 + 0x10*ch)
  private dmap = new Uint8Array(8);   // $43x0
  private bbad = new Uint8Array(8);   // $43x1
  private a1tl = new Uint16Array(8);  // $43x2-$43x3 (little endian)
  private a1b = new Uint8Array(8);    // $43x4
  private das = new Uint16Array(8);   // $43x5-$43x6

  // Controllers
  private controller1 = new Controller();
  private ctrlStrobe = 0;

  // APU I/O stub ports
  private apuToCpu = new Uint8Array(4); // values read by CPU at $2140-$2143
  private cpuToApu = new Uint8Array(4); // last written by CPU at $2140-$2143
  private apuPolls = 0;
  private apuHandshakeSeenCC = false;
  private apuPhase: 'boot' | 'acked' | 'busy' | 'done' = 'boot';
  private apuBusyReadCount = 0;

  // CPU I/O registers we model minimally
  private nmitimen = 0; // $4200 (bit7 enables NMI)
  private nmiOccurred = 0; // latched NMI flag for $4210 bit7

  // Math registers (8x8 multiply, 16/8 divide)
  private wrmpya = 0; // $4202
  private wrmpyb = 0; // $4203 (write triggers multiply)
  private wrdiv = 0;  // $4204/$4205 16-bit dividend
  private wrdivb = 0; // $4206 divisor (write triggers division)

  private mulProduct = 0;     // 16-bit product
  private divQuotient = 0;    // 16-bit quotient
  private divRemainder = 0;   // 16-bit remainder
  private lastMathOp: 'none' | 'mul' | 'div' = 'none';

  private logMMIO = false;
  private logLimit = 1000;
  private logCount = 0;
  private apuShimEnabled = false; // Env-gated shim to simulate unblank after handshake
  private apuShimCountdownReads = -1;

  constructor(private cart: Cartridge) {
    // Optional MMIO logging controlled by env vars
    try {
      // @ts-ignore
      const env = (globalThis as any).process?.env ?? {};
      this.logMMIO = env.SMW_LOG_MMIO === '1' || env.SMW_LOG_MMIO === 'true';
      const lim = Number(env.SMW_LOG_LIMIT ?? '1000');
      if (Number.isFinite(lim) && lim > 0) this.logLimit = lim;
      this.apuShimEnabled = env.SMW_APU_SHIM === '1' || env.SMW_APU_SHIM === 'true';
    } catch {
      // ignore if process.env not available
    }
    // Initialize simple APU handshake values so games can progress without a real SPC700
    this.apuToCpu[0] = 0xaa; // common boot handshake value
    this.apuToCpu[1] = 0xbb;
    this.apuPhase = 'boot';
    this.apuToCpu[2] = 0x00;
    this.apuToCpu[3] = 0x00;
  }

  // Internal helper to access WRAM linear index
  private wramIndex(bank: number, off: number): number {
    return ((bank & 1) << 16) | off;
  }

  private mapRead(addr: number): Byte {
    const bank = (addr >>> 16) & 0xff;
    const off = addr & 0xffff;

    // Optional MMIO read logging
    const isPPU = (off & 0xff00) === 0x2100;
    const isCPU = (off >= 0x4200 && off <= 0x421f) || off === 0x4016;
    const shouldLog = this.logMMIO && (isPPU || isCPU) && this.logCount < this.logLimit;

    // WRAM mirrors
    if (bank === 0x7e || bank === 0x7f) {
      return this.wram[this.wramIndex(bank, off)];
    }
    // Low WRAM mirrors in banks 00-3F and 80-BF at $0000-$1FFF
    if (((bank <= 0x3f) || (bank >= 0x80 && bank <= 0xbf)) && off < 0x2000) {
      return this.wram[off & 0x1fff];
    }

    // PPU MMIO $2100-$213F only
    if (off >= 0x2100 && off <= 0x213f) {
      const v = this.ppu.readReg(off & 0x00ff);
      if (shouldLog) {
        // eslint-disable-next-line no-console
        console.log(`[MMIO] R ${bank.toString(16).padStart(2,'0')}:${off.toString(16).padStart(4,'0')} -> ${v.toString(16).padStart(2,'0')}`);
        this.logCount++;
      }
      return v;
    }

    // APU/io and CPU status ports

    // $4210 RDNMI: NMI occurred latch (bit7). Read clears the latch.
    if (off === 0x4210) {
      const v = (this.nmiOccurred ? 0x80 : 0x00);
      this.nmiOccurred = 0;
      if (shouldLog) {
        // eslint-disable-next-line no-console
        console.log(`[MMIO] R ${bank.toString(16).padStart(2,'0')}:${off.toString(16).padStart(4,'0')} -> ${v.toString(16).padStart(2,'0')}`);
        this.logCount++;
      }
      return v;
    }

    // $4212 HVBJOY: VBlank status on bit7, HBlank status on bit6
    if (off === 0x4212) {
      const vblank = this.ppu.scanline >= 224; // simple model: lines >=224 are VBlank
      const hblank = this.ppu.hblank;
      const v = (vblank ? 0x80 : 0x00) | (hblank ? 0x40 : 0x00);
      if (shouldLog) {
        // eslint-disable-next-line no-console
        console.log(`[MMIO] R ${bank.toString(16).padStart(2,'0')}:${off.toString(16).padStart(4,'0')} -> ${v.toString(16).padStart(2,'0')}`);
        this.logCount++;
      }
      return v;
    }

    // $4214/$4215: RDDIVL/RDDIVH (quotient low/high)
    if (off === 0x4214) {
      const v = this.divQuotient & 0xff;
      if (shouldLog) { console.log(`[MMIO] R ${bank.toString(16).padStart(2,'0')}:${off.toString(16).padStart(4,'0')} -> ${v.toString(16).padStart(2,'0')}`); this.logCount++; }
      return v;
    }
    if (off === 0x4215) {
      const v = (this.divQuotient >>> 8) & 0xff;
      if (shouldLog) { console.log(`[MMIO] R ${bank.toString(16).padStart(2,'0')}:${off.toString(16).padStart(4,'0')} -> ${v.toString(16).padStart(2,'0')}`); this.logCount++; }
      return v;
    }

    // $4216/$4217: RDMPYL/RDMPYH (product low/high if last op multiply; remainder if last op divide)
    if (off === 0x4216) {
      let v = 0x00;
      if (this.lastMathOp === 'mul') v = this.mulProduct & 0xff;
      else if (this.lastMathOp === 'div') v = this.divRemainder & 0xff;
      if (shouldLog) { console.log(`[MMIO] R ${bank.toString(16).padStart(2,'0')}:${off.toString(16).padStart(4,'0')} -> ${v.toString(16).padStart(2,'0')}`); this.logCount++; }
      return v;
    }
    if (off === 0x4217) {
      let v = 0x00;
      if (this.lastMathOp === 'mul') v = (this.mulProduct >>> 8) & 0xff;
      else if (this.lastMathOp === 'div') v = (this.divRemainder >>> 8) & 0xff;
      if (shouldLog) { console.log(`[MMIO] R ${bank.toString(16).padStart(2,'0')}:${off.toString(16).padStart(4,'0')} -> ${v.toString(16).padStart(2,'0')}`); this.logCount++; }
      return v;
    }

    // APU I/O ports $2140-$2143
    if (off >= 0x2140 && off <= 0x2143) {
      const idx = off - 0x2140;
      let v = this.apuToCpu[idx] & 0xff;

      // After ACK, emulate a minimal busy/ready toggle on port0 to break simple wait loops
      if (idx === 0) {
        if (this.apuPhase === 'acked') {
          // Begin busy phase
          this.apuPhase = 'busy';
          this.apuBusyReadCount = 0;
        }
        if (this.apuPhase === 'busy') {
          // Toggle bit7 (0x80) every 16 reads to simulate a service loop
          this.apuBusyReadCount++;
          v = (Math.floor(this.apuBusyReadCount / 16) % 2) ? 0x80 : 0x00;
          this.apuToCpu[0] = v;
          // Shim: countdown to unblank
          if (this.apuShimEnabled && this.apuShimCountdownReads > 0) {
            this.apuShimCountdownReads--;
            if (this.apuShimCountdownReads === 0) {
              // Simulate that the game unblanked and enabled BG1
              this.ppu.writeReg(0x00, 0x0f); // INIDISP
              this.ppu.writeReg(0x2c, 0x01); // TM enable BG1
              // End busy; hold ports low
              this.apuPhase = 'done';
              this.apuToCpu[0] = 0x00;
              this.apuToCpu[1] = 0x00;
            }
          }
          // After enough toggles, mark done and hold at 0x00 (fallback)
          if (this.apuBusyReadCount > 2048 && !this.apuShimEnabled) {
            this.apuPhase = 'done';
            this.apuToCpu[0] = 0x00;
            this.apuToCpu[1] = 0x00;
          }
        }
      }

      if (shouldLog) {
        console.log(`[MMIO] R ${bank.toString(16).padStart(2,'0')}:${off.toString(16).padStart(4,'0')} -> ${v.toString(16).padStart(2,'0')}`);
        this.logCount++;
      }
      return v;
    }

    // APU/io ranges not implemented for read

    // Controller ports $4016/$4017 (we only model $4016 bit0)
    if (off === 0x4016) {
      const bit = this.controller1.readBit();
      return bit;
    }

    // ROM mapping (simplified LoROM/HiROM)
    if (this.cart.mapping === 'lorom') {
      // LoROM: banks 0x00-0x7D, 0x80-0xFF: 0x8000-0xFFFF map to ROM in 32KiB chunks
      if (off >= 0x8000) {
        const loBank = bank & 0x7f;
        const romAddr = (loBank * 0x8000) + (off - 0x8000);
        return this.cart.rom[romAddr % this.cart.rom.length];
      }
    } else {
      // HiROM: banks 0x40-0x7D, 0xC0-0xFF: 0x0000-0xFFFF map to ROM in 64KiB chunks
      const hiBank = bank & 0x7f;
      const romAddr = (hiBank * 0x10000) + off;
      return this.cart.rom[romAddr % this.cart.rom.length];
    }

    // Default open bus 0x00
    return 0x00;
  }

  private performMDMA(mask: Byte): void {
    for (let ch = 0; ch < 8; ch++) {
      if ((mask & (1 << ch)) === 0) continue;
      const mode = this.dmap[ch] & 0x07;
      const dirBtoA = (this.dmap[ch] & 0x80) !== 0; // 1 = B->A, 0 = A->B
      const baseB = this.bbad[ch]; // $21xx base
      let aAddr = this.a1tl[ch];
      const aBank = this.a1b[ch];
      let count = this.das[ch] || 0x10000; // 0 means 65536 bytes in hardware; here handle 0 as 0x10000

      while (count > 0) {
        // Determine B address per mode (support mode 0 and 1 only)
        let bOff = baseB;
        if (mode === 1) {
          // Alternate between base and base+1 per transfer
          const toggled = ((this.das[ch] - count) & 1) !== 0;
          bOff = baseB + (toggled ? 1 : 0);
        }
        const bAddr = 0x002100 | (bOff & 0xff);

        if (dirBtoA) {
          const val = this.mapRead(bAddr);
          // write to A-bus location
          const la = ((aBank << 16) | aAddr) >>> 0;
          this.write8(la, val);
        } else {
          // A->B
          const la = ((aBank << 16) | aAddr) >>> 0;
          const val = this.read8(la);
          this.mapWrite(bAddr, val);
        }

        // Increment A address (mode 0/1 always increment)
        aAddr = (aAddr + 1) & 0xffff;
        count--;
      }

      // Update channel registers post-transfer
      this.a1tl[ch] = aAddr;
      this.das[ch] = 0;
    }
  }

  private mapWrite(addr: number, value: Byte): void {
    const bank = (addr >>> 16) & 0xff;
    const off = addr & 0xffff;

    // Optional MMIO logging for $2100-$21FF and $4200-$421F and $4016
    const isPPU = (off & 0xff00) === 0x2100;
    const isCPU = (off >= 0x4200 && off <= 0x421f) || off === 0x4016;
    if (this.logMMIO && (isPPU || isCPU) && this.logCount < this.logLimit) {
      // eslint-disable-next-line no-console
      console.log(`[MMIO] W ${bank.toString(16).padStart(2,'0')}:${off.toString(16).padStart(4,'0')} <- ${value.toString(16).padStart(2,'0')}`);
      this.logCount++;
    }

    if (bank === 0x7e || bank === 0x7f) {
      this.wram[this.wramIndex(bank, off)] = value & 0xff;
      return;
    }
    // Low WRAM mirrors in banks 00-3F and 80-BF at $0000-$1FFF
    if (((bank <= 0x3f) || (bank >= 0x80 && bank <= 0xbf)) && off < 0x2000) {
      this.wram[off & 0x1fff] = value & 0xff;
      return;
    }

    // PPU MMIO $2100-$213F only
    if (off >= 0x2100 && off <= 0x213f) {
      this.ppu.writeReg(off & 0x00ff, value & 0xff);
      return;
    }

    // APU I/O ports $2140-$2143
    if (off >= 0x2140 && off <= 0x2143) {
      const idx = off - 0x2140;
      this.cpuToApu[idx] = value & 0xff;

      // Heuristic handshake for common boot code (e.g., SMW):
      // - CPU polls port0 until it reads 0xAA
      // - CPU writes 0x01 to port1 and 0xCC to port0 to initiate transfer/reset
      // - APU responds by clearing port0 to 0x00 to acknowledge
      if (idx === 0 && value === 0xcc) {
        this.apuHandshakeSeenCC = true;
        this.apuToCpu[0] = 0x00; // acknowledge
        // Move to ACKed phase; reads will transition to busy toggle
        this.apuPhase = 'acked';
        // If shim enabled, arm a countdown so we simulate progress to unblank
        if (this.apuShimEnabled) {
          // After a short while of CPU polling port0, simulate that APU init completed.
          this.apuShimCountdownReads = 256; // number of reads from $2140 until we unblank
        }
      }
      if (idx === 1 && value === 0x01 && this.apuHandshakeSeenCC) {
        // Clear port1 as part of ack transition
        this.apuToCpu[1] = 0x00;
      }
      return;
    }

    // Controller strobe $4016 write
    if (off === 0x4016) {
      this.ctrlStrobe = value & 1;
      this.controller1.writeStrobe(value);
      return;
    }

    // DMA registers $4300-$437F
    if (off >= 0x4300 && off <= 0x437f) {
      const ch = (off - 0x4300) >> 4; // 0..7
      const reg = off & 0x000f;
      switch (reg) {
        case 0x0: this.dmap[ch] = value & 0xff; break;      // DMAP
        case 0x1: this.bbad[ch] = value & 0xff; break;      // BBAD
        case 0x2: this.a1tl[ch] = (this.a1tl[ch] & 0xff00) | value; break; // A1T low
        case 0x3: this.a1tl[ch] = (this.a1tl[ch] & 0x00ff) | (value << 8); break; // A1T high
        case 0x4: this.a1b[ch] = value & 0xff; break;       // A1B
        case 0x5: this.das[ch] = (this.das[ch] & 0xff00) | value; break; // DAS low
        case 0x6: this.das[ch] = (this.das[ch] & 0x00ff) | (value << 8); break; // DAS high
        // Others ignored for now
      }
      return;
    }

    // NMITIMEN $4200
    if (off === 0x4200) {
      this.nmitimen = value & 0xff;
      return;
    }

    // Multiply/Divide registers
    if (off === 0x4202) { // WRMPYA (multiplicand A)
      this.wrmpya = value & 0xff;
      return;
    }
    if (off === 0x4203) { // WRMPYB (multiplicand B) -> trigger 8x8 multiply
      this.wrmpyb = value & 0xff;
      this.mulProduct = (this.wrmpya * this.wrmpyb) & 0xffff;
      this.lastMathOp = 'mul';
      return;
    }
    if (off === 0x4204) { // WRDIVL (dividend low)
      this.wrdiv = (this.wrdiv & 0xff00) | (value & 0xff);
      return;
    }
    if (off === 0x4205) { // WRDIVH (dividend high)
      this.wrdiv = ((value & 0xff) << 8) | (this.wrdiv & 0xff);
      return;
    }
    if (off === 0x4206) { // WRDIVB (divisor) -> trigger 16/8 divide
      this.wrdivb = value & 0xff;
      if (this.wrdivb === 0) {
        this.divQuotient = 0xffff;
        this.divRemainder = this.wrdiv & 0xffff;
      } else {
        this.divQuotient = Math.floor((this.wrdiv & 0xffff) / this.wrdivb) & 0xffff;
        this.divRemainder = ((this.wrdiv & 0xffff) % this.wrdivb) & 0xffff;
      }
      this.lastMathOp = 'div';
      return;
    }

    // MDMAEN $420B
    if (off === 0x420b) {
      this.performMDMA(value & 0xff);
      return;
    }

    // TODO: Other MMIO, SRAM, etc.
  }

  read8(addr: number): Byte {
    return this.mapRead(addr & 0xffffff);
  }

  read16(addr: number): Word {
    const a = addr & 0xffffff;
    const lo = this.read8(a);
    const hi = this.read8((a + 1) & 0xffffff);
    return (hi << 8) | lo;
  }

  write8(addr: number, value: Byte): void {
    this.mapWrite(addr & 0xffffff, value & 0xff);
  }

  write16(addr: number, value: Word): void {
    const a = addr & 0xffffff;
    this.write8(a, value & 0xff);
    this.write8((a + 1) & 0xffffff, (value >>> 8) & 0xff);
  }

  // Minimal NMI enable query for scheduler
  public isNMIEnabled(): boolean {
    return (this.nmitimen & 0x80) !== 0;
  }

  // Called by scheduler at end-of-frame when NMI is triggered
  public pulseNMI(): void {
    this.nmiOccurred = 1;
  }
}

