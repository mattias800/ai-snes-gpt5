# SMW APU shim and test flags

This project includes a lightweight APU (SPC700) handshake shim so Super Mario World (SMW) can progress far enough to perform MMIO writes and (optionally) show a visible pixel in headless CI.

All behavior is off by default unless environment variables are set.

Environment flags:

- SMW_ROM
  Path to the SMW ROM used by env-gated tests.

- SMW_APU_SHIM
  Enable the APU shim. When enabled, the bus simulates a simple handshake on $2140-$2143 after detecting the typical CPU write sequence (0xCC to $2140 and 0x01 to $2141).

- SMW_APU_SHIM_ONLY_HANDSHAKE
  When true, the shim performs the handshake only and does not write any PPU registers. Use this to let the ROM drive PPU state.

- SMW_APU_SHIM_UNBLANK
  When true (default), the shim will write to INIDISP ($2100) and TM ($212C) at the end of its countdown to ensure a visible frame. Set to 0 when using ONLY_HANDSHAKE.

- SMW_APU_SHIM_TILE
  When true (default), the shim injects a simple BG1 tile and palette after the countdown for CI visibility. Disable (0) if you want to assert purely ROM-driven VRAM/CGRAM changes.

- SMW_APU_SHIM_TOGGLE_PERIOD
  Period (in reads of $2140) for the shim’s busy/ready bit7 toggle. Default: 16.

- SMW_APU_SHIM_READY_TOGGLES
  Number of busy toggles to wait before the shim transitions to the ready/done state when the explicit read countdown isn’t armed. Default: 128.

- SMW_APU_SHIM_COUNTDOWN_READS
  Number of reads from $2140 after handshake ACK before the shim completes its busy phase (and optionally unblanks/injects). Default: 256. Set to 0 to transition immediately.

- SMW_APU_SHIM_ECHO_PORTS
  When true, the shim echoes CPU writes on ports $2141-$2143 back to the CPU reads. This can help ROMs expecting minimal mailbox behavior. Default: off.

- SMW_APU_SHIM_READY_ON_ZERO
  When true, writing 0x00 to $2140 during the busy phase forces the shim to finish immediately (then optionally unblank/inject). Default: off.

- SMW_APU_SHIM_READY_PORT, SMW_APU_SHIM_READY_VALUE
  If set (READY_PORT in 1..3 for $2141-$2143 and READY_VALUE 0..255), a write of READY_VALUE to the selected port during the busy phase completes the shim immediately (then optionally unblank/inject). Default: disabled.

- SMW_IPS
  Instructions per scanline used by the test scheduler. Defaults vary per test (commonly 800).

- SMW_FRAMES
  Number of frames to run within env-gated tests. Defaults vary per test (commonly 600-800 frames).

Recommended combinations:

- To verify the ROM unblanks under shim influence:
  SMW_APU_SHIM=1

- To verify ROM-driven VRAM/CGRAM activity (no injected pixel):
  SMW_APU_SHIM=1 SMW_APU_SHIM_ONLY_HANDSHAKE=1 SMW_APU_SHIM_UNBLANK=0 SMW_APU_SHIM_TILE=0

Notes:
- Tests in tests/emulator/smw_*.test.ts are env-gated and skipped unless SMW_ROM (and for some tests, SMW_APU_SHIM) are provided.
- The shim’s behavior is intentionally simple and is not a full SPC700 emulation.

