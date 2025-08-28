# ai-snes-gpt5

A TypeScript SNES emulator developed with zero manual testing until acceptance criteria signal readiness to run Super Mario World.

- See docs/EMULATOR_PLAN.md for the roadmap and testing strategy.
- Optional SPC700 core: set APU_SPC700_CORE=1 (or APU_SPC700_MODE=core) together with SMW_SPC700=1 to enable the new APUDevice under the existing SPC700 wrapper. Without these env flags, the legacy handshake shim remains active.
- This repository does not and will not include copyrighted ROMs.

## PPU color math and windowing (simplified model)

This project intentionally implements a simplified subset of the SNES PPU window and color math behavior to keep tests deterministic and focused. Highlights:

- CGADSUB ($2131)
  - bit5: global enable of color math in our model
  - bit7: 1=subtract, 0=add
  - bit6: half (applies after add/sub)
  - bits0..4: per-layer mask: BG1(0), BG2(1), BG3(2), BG4(3), OBJ(4). mask=0 means apply to all (including backdrop)
- CGWSEL ($2130)
  - bit0: applyInside: 1=apply color math inside the window, 0=outside
  - bit1: also gate the subscreen by the window
  - bit2: when subscreen is absent or masked, use fixed color (COLDATA $2132) as subscreen
  - bit3: clip-to-black on the non-math side of the window (instead of showing pure main color)
  - bits6..7: window combine mode: 00=OR, 01=AND, 10=XOR, 11=XNOR
- Windows
  - Two inclusive ranges (wrap-around supported): A[WH0..WH1], B[WH2..WH3]
  - W12SEL ($2123): BG1: A(bit0), B(bit1), invA(bit4), invB(bit5); BG2: A(bit2), B(bit3), invA(bit6), invB(bit7)
  - W34SEL ($2124): BG3: A(bit0), B(bit1), invA(bit4), invB(bit5); BG4: A(bit2), B(bit3), invA(bit6), invB(bit7)
  - WOBJSEL ($2125): OBJ: A(bit0), B(bit1), invA(bit4), invB(bit5); Backdrop: A(bit2), B(bit3), invA(bit6), invB(bit7)

Notes:
- Backdrop and OBJ participate in the same color window with per-layer enables via the selectors above.
- Brightness (INIDISP $2100) scales the final RGBA after color math.
- Fixed color (COLDATA $2132) is used as subscreen when CGWSEL bit2 is set and no eligible subscreen pixel is present (or subscreen is masked by window gating).

This behavior is validated by an extensive Vitest suite. See tests/ppu/*window* and *color_math* for coverage.

## Optional third-party test ROMs

This repo bundles upstream community SNES test ROMs in a zip for convenience. They are not executed by default.

- To extract and enable related smoke tests locally:

  npm run setup:snes-tests

- Then run the focused smoke tests:

  npx vitest run --reporter=dot tests/emulator/snes_tests_smoke.test.ts
  npx vitest run --reporter=dot tests/cpu/cputest_vectors_smoke.test.ts

In CI, these smoke tests run in a separate job but remain lightweight and non-authoritative.

