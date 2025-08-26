# Third-party SNES tests (snes-tests)

This repo bundles the community “snes-tests” suite under third_party/snes-tests (zip only). You can optionally extract and run automated checks against our emulator.

Setup
- Extract the bundled zip:
  npm run setup:snes-tests

What’s included
- CPU tests (65C816): cputest/tests-basic.txt, cputest/tests-full.txt and .sfc ROMs
- SPC700 tests: spctest/tests.txt and spctest.sfc (execution disabled until SPC700 core exists)

How we verify
- We parse the auto-generated tests-*.txt files and execute each vector on a minimal test memory bus and our CPU core. We compare:
  - Registers: A, X, Y, P, E (and S, D, DBR when present)
  - Memory bytes listed in the Expected output line
- Vectors marked as “Additional initialization or checks are performed” are skipped for now because they depend on extra assembly scaffolding in the ROM.

Running
- Run a quick ALU subset (adc/and/eor/ora/sbc) using vectors from tests-*.txt:
  npm run test:snes-vectors
  # Environment knobs:
  #   SNES_TESTS_DIR=third_party/snes-tests (default)
  #   CPU_VECTORS_LIMIT=500 (limit number of vectors)
  #   CPU_VECTORS_MODE=basic|full (the suite auto-detects; this forces a file)

- Run the same in “full” mode (if performance is acceptable):
  npm run test:snes-vectors:full

CI
- Smoke execution of ROMs already runs in the snes-tests-smoke job.
- This vector suite is designed to be fast and deterministic; we keep the default limit conservative in CI.

Notes
- The current assembler covers the ALU subset (adc/and/eor/ora/sbc) across addressing modes used by the generator. Additional mnemonics will be enabled incrementally.
- SPC700 vectors are parsed only when we add a real SPC700 core; until then, execution is skipped.

