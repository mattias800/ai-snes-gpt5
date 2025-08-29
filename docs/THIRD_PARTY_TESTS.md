# Third-party SNES tests (snes-tests)

Canonical source path for the test suites is test-roms/snes-tests (present in this repo). We build ROMs and auto-generated vector lists from source and run them against our emulator.

Setup
- Build the suites from source (requires cc65 and Python for CPU; spcasm and Python for APU):
  npm run build:snes-tests

What’s included
- CPU tests (65C816): cputest/tests-basic.txt, cputest/tests-full.txt and .sfc ROMs (cputest-basic.sfc, cputest-full.sfc)
- SPC700 tests: spctest/tests.txt and spctest.sfc

How we verify
- Vectors: We parse the auto-generated tests-*.txt files and execute each vector on a minimal test memory bus and our core(s). We compare:
  - Registers: A, X, Y, P, E (and S, D, DBR when present)
  - Memory bytes listed in the Expected output line
- ROMs: We boot the ROMs headlessly and probe BG1 tilemap text in VRAM to detect "Success" or "Failed" printed by the ROM.

Running
- Vectors (ALU subset by default):
  npm run test:snes-vectors
  # Environment knobs:
  #   SNES_TESTS_DIR=test-roms/snes-tests (default)
  #   CPU_VECTORS_LIMIT=500 (limit number of vectors)
  #   CPU_VECTORS_MODE=basic|full (force a file)

- Full vectors mode:
  npm run test:snes-vectors:full

- SPC700 vectors (requires SPC core support):
  npm run test:spc-vectors

- ROM pass/fail probes (opt-in via RUN_SNES_ROMS):
  npm run test:snes-roms:cpu           # CPU basic ROM
  npm run test:snes-roms:apu           # SPC ROM (requires real APU core)
  npm run test:snes-roms:all           # both

CI
- The existing snes-tests-smoke job boots ROMs when prebuilt assets are available.
- An optional snes-roms-passfail job (gated by RUN_SNES_ROMS=1) builds from source, runs vectors and the new pass/fail probes.
- Vector suites are designed to be fast and deterministic; keep conservative limits in CI to avoid flakiness.

Notes
- Default SNES_TESTS_DIR is test-roms/snes-tests; third_party/snes-tests remains supported only for legacy zip extraction via setup:snes-tests.
- All ROM-based tests are opt-in: set RUN_SNES_ROMS=1 to enable.
- Ensure required toolchains are installed (cc65, spcasm, make, python3).
