# SNES Audio Emulation Status

## ✅ Working Features

### BRR Decoder
- Correctly decodes BRR compressed audio samples
- Proper handling of END and LOOP flags (bit 0 = END, bit 1 = LOOP)
- All 4 filter modes implemented
- Range/shift handling working correctly
- Produces audible output with real SPC files

### DSP (Digital Signal Processor)
- 8 voice channels with independent control
- Pitch-based resampling with phase accumulation
- 4-tap Gaussian-like interpolation
- Master volume control (MVOLL/MVOLR)
- Per-voice volume control
- Voice masking support
- Basic echo buffer implementation

### Envelope Generation
- ADSR envelope modes
- Direct GAIN control
- Attack, Decay, Sustain phases working
- Proper envelope scaling of audio output

### SPC700 CPU
- Most opcodes implemented and working
- Can load and partially execute real SPC files
- Timer support for synchronization

## 🔧 Current Limitations

### SMP CPU / Music Sequencing
- **Main issue**: SPC snapshots are paused, waiting for main CPU commands
- The SMP loops at addresses like 0x12FC-0x1301 polling for communication
- Music sequencer code doesn't run without proper CPU<->APU protocol emulation
- Force-KON plays all voices simultaneously as a static chord, not the intended melody

### Audio Quality (Mostly Fixed)
- ✅ BRR decoding works correctly
- ✅ Envelope generation functional (though timing could be more accurate)
- ✅ Audio mixing pipeline produces clean output
- Sustained notes play indefinitely when envelopes are held at sustain level

### Integration
- Requires force-KON flag to hear any audio from most SPCs
- Need to implement main CPU communication protocol for actual music playback
- Alternative: Find SPCs that auto-play or patch the SMP code to start playback

## 📊 Test Results

### Yoshi's Island SPC
```bash
npx tsx scripts/spc_to_wav.ts --in=test-spc/yoshi.spc --out=yoshi.wav --seconds=10 --force-kon=1 --gain=10 --preroll-ms=0
```
- Peak amplitude: ~18.5%
- Requires forced KON due to SMP waiting for commands

### Zelda SPC
```bash
npx tsx scripts/spc_to_wav.ts --in="test-spc/zelda/10 Guessing-Game House.spc" --out=zelda.wav --seconds=10 --gain=5
```
- Peak amplitude: ~34%
- Better initialization, produces stronger audio
- More complex envelope patterns

## 🎵 Audio Sample Generation

To generate a WAV file from an SPC:

```bash
# Basic usage
npx tsx scripts/spc_to_wav.ts --in=input.spc --out=output.wav --seconds=30

# With gain boost and forced key-on (for SPCs that don't auto-start)
npx tsx scripts/spc_to_wav.ts --in=input.spc --out=output.wav --seconds=30 --force-kon=1 --gain=10 --preroll-ms=0

# With debugging
npx tsx scripts/spc_to_wav.ts --in=input.spc --out=output.wav --seconds=10 --trace-mix=1 --trace-decode=100
```

### Options
- `--gain=N`: Amplification factor (default: 1)
- `--force-kon=1`: Force all voices to key-on at start
- `--preroll-ms=N`: Milliseconds to run before capture (default: 200)
- `--allow-silence=1`: Don't fail on silent output
- `--mask=0xFF`: Voice mask (bit per voice, 0xFF = all voices)
- `--trace-mix=1`: Trace DSP mixing
- `--trace-decode=N`: Trace first N BRR decode events
- `--rate=N`: Sample rate (default: 32000)

## 🧪 Testing

Run audio tests:
```bash
npm test -- tests/apu/audio_basic.test.ts
```

The test suite verifies:
- BRR decoding produces non-zero samples
- END/LOOP flag handling
- Envelope generation
- Volume control
- Audio mixing pipeline

## 🎯 Next Steps

### To Get Full Music Playback:
1. **Implement proper timer IRQ handling** - Music engines use timer interrupts to advance sequences
2. **Reverse-engineer communication protocols** - Each game has specific handshake patterns
3. **Find "playing" SPC captures** - SPCs captured mid-song rather than paused
4. **Implement music engine detection** - Auto-detect N-SPC, Rare, Konami engines etc.

### Technical Improvements:
1. **Complete SMP opcode implementation** - Add remaining opcodes for full compatibility
2. **Fine-tune envelope rates** - Match hardware timing more closely  
3. **Improve echo/reverb** - Implement proper FIR filter coefficients
4. **Performance optimization** - Currently using floating point; could use fixed-point

## 🔧 Using the Enhanced Renderer

The `spc_renderer.ts` script provides a "fake SNES" environment that tries to drive music playback:

```bash
# Basic usage with auto-patching and forced timers
npx tsx scripts/spc_renderer.ts --in=input.spc --out=output.wav --seconds=30 --gain=5

# Try different communication modes
npx tsx scripts/spc_renderer.ts --in=input.spc --out=output.wav --comm=nspc
npx tsx scripts/spc_renderer.ts --in=input.spc --out=output.wav --comm=rare

# Debug options
npx tsx scripts/spc_renderer.ts --in=input.spc --out=output.wav --trace-mix --trace-decode=100
```

The renderer automatically:
- Patches wait loops to bypass CPU communication waits
- Forces timer IRQs to drive music engine ticks
- Simulates main CPU acknowledgments
- Tries to detect and start music playback

However, full music playback requires deeper reverse-engineering of each game's specific music engine protocol.
