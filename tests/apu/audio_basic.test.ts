import { describe, it, expect } from 'vitest';
import { SDSP } from '../../src/apu/sdsp';

describe('Basic Audio Output', () => {
  it('should produce non-zero audio when voice is keyed on with valid BRR data', () => {
    const dsp = new SDSP();
    const aram = new Uint8Array(0x10000);
    
    // Setup directory at 0x100
    const dirBase = 0x100;
    // Entry 0 points to sample at 0x200
    aram[dirBase + 0] = 0x00; aram[dirBase + 1] = 0x02; // START = 0x0200
    aram[dirBase + 2] = 0x00; aram[dirBase + 3] = 0x02; // LOOP = 0x0200
    
    // Simple BRR block at 0x200 with actual sample data
    aram[0x200] = 0xC3; // header: range=12, filter=0, END+LOOP
    // Sample nibbles (will be shifted by range)
    aram[0x201] = 0x12; // nibbles: 1, 2
    aram[0x202] = 0x34; // nibbles: 3, 4
    aram[0x203] = 0x56; // nibbles: 5, 6
    aram[0x204] = 0x78; // nibbles: 7, -8
    aram[0x205] = 0x9A; // nibbles: -7, -6
    aram[0x206] = 0xBC; // nibbles: -5, -4
    aram[0x207] = 0xDE; // nibbles: -3, -2
    aram[0x208] = 0xF0; // nibbles: -1, 0
    
    dsp.attachAram(aram);
    
    // Setup DSP registers
    dsp.writeAddr(0x5d); dsp.writeData(0x01); // DIR = 0x01 (dirBase = 0x100)
    
    // Voice 0 setup
    dsp.writeAddr(0x00); dsp.writeData(64); // VOL(L)
    dsp.writeAddr(0x01); dsp.writeData(64); // VOL(R)
    dsp.writeAddr(0x02); dsp.writeData(0x00); // PITCHL
    dsp.writeAddr(0x03); dsp.writeData(0x10); // PITCHH (pitch = 0x1000)
    dsp.writeAddr(0x04); dsp.writeData(0); // SRCN = 0
    dsp.writeAddr(0x05); dsp.writeData(0x00); // ADSR1 (ADSR off)
    dsp.writeAddr(0x07); dsp.writeData(0x7F); // GAIN (direct, max level)
    
    // Master volumes
    dsp.writeAddr(0x0c); dsp.writeData(127); // MVOLL
    dsp.writeAddr(0x1c); dsp.writeData(127); // MVOLR
    
    // Key on voice 0
    dsp.writeAddr(0x4c);
    dsp.writeData(0x01);
    
    // Mix samples and check for non-zero output
    let hasNonZero = false;
    let maxAbs = 0;
    
    for (let i = 0; i < 100; i++) {
      const [l, r] = dsp.mixSample();
      if (l !== 0 || r !== 0) {
        hasNonZero = true;
        maxAbs = Math.max(maxAbs, Math.abs(l), Math.abs(r));
      }
    }
    
    expect(hasNonZero).toBe(true);
    expect(maxAbs).toBeGreaterThan(0);
    expect(maxAbs).toBeLessThanOrEqual(32767);
  });

  it('should handle BRR blocks with END flag correctly', () => {
    const dsp = new SDSP();
    const aram = new Uint8Array(0x10000);
    
    // Setup directory at 0x100
    const dirBase = 0x100;
    // Entry 0: START points to block with only LOOP flag, LOOP points to real data
    aram[dirBase + 0] = 0x00; aram[dirBase + 1] = 0x02; // START = 0x0200
    aram[dirBase + 2] = 0x10; aram[dirBase + 3] = 0x02; // LOOP = 0x0210
    
    // First block at 0x200: LOOP flag only, zero data (common pattern)
    aram[0x200] = 0x02; // header: range=0, filter=0, LOOP only
    for (let i = 1; i <= 8; i++) aram[0x200 + i] = 0x00;
    
    // Second block at 0x209: actual sample data  
    aram[0x209] = 0xB3; // header: range=11, filter=0, END+LOOP
    aram[0x20A] = 0x11;
    aram[0x20B] = 0x22;
    aram[0x20C] = 0x33;
    aram[0x20D] = 0x44;
    aram[0x20E] = 0x55;
    aram[0x20F] = 0x66;
    aram[0x210] = 0x77;
    aram[0x211] = 0x88;
    
    // Loop block at 0x210: continuing sample
    aram[0x212] = 0xA3; // header: range=10, filter=0, END+LOOP
    aram[0x213] = 0x99;
    aram[0x214] = 0xAA;
    aram[0x215] = 0xBB;
    aram[0x216] = 0xCC;
    aram[0x217] = 0xDD;
    aram[0x218] = 0xEE;
    aram[0x219] = 0xFF;
    aram[0x21A] = 0x00;
    
    dsp.attachAram(aram);
    
    // Setup DSP
    dsp.writeAddr(0x5d); dsp.writeData(0x01); // DIR = 0x01
    dsp.writeAddr(0x00); dsp.writeData(100); // VOL(L)
    dsp.writeAddr(0x01); dsp.writeData(100); // VOL(R)
    dsp.writeAddr(0x02); dsp.writeData(0x00); // PITCHL
    dsp.writeAddr(0x03); dsp.writeData(0x10); // PITCHH
    dsp.writeAddr(0x04); dsp.writeData(0); // SRCN
    dsp.writeAddr(0x05); dsp.writeData(0x00); // ADSR1 off
    dsp.writeAddr(0x07); dsp.writeData(0x7F); // GAIN max
    dsp.writeAddr(0x0c); dsp.writeData(127); // MVOLL
    dsp.writeAddr(0x1c); dsp.writeData(127); // MVOLR
    
    // Key on
    dsp.writeAddr(0x4c);
    dsp.writeData(0x01);
    
    // Should decode through the zero block and reach real audio
    let foundNonZero = false;
    for (let i = 0; i < 200; i++) {
      const [l, r] = dsp.mixSample();
      if (l !== 0 || r !== 0) {
        foundNonZero = true;
        break;
      }
    }
    
    expect(foundNonZero).toBe(true);
  });
});
