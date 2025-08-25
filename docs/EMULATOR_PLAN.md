# SNES Emulator (TypeScript) — Development and Automated Testing Plan

Goal
- Build a Super Nintendo (SNES) emulator in TypeScript with zero manual testing during development.
- Final target: Run Super Mario World (SMW) with keyboard controls and audio in a web frontend. We will only manually test once the test suite indicates a high confidence that it will work.

Principles
- Test-driven development: every module is developed against automated tests first.
- Reproducibility: deterministic execution for CPU/APU/PPU in tests; PRNG-seeded tests are logged.
- Separation of concerns: pure core (emulation) is platform-agnostic; UI/audio handled by a separate frontend package.
- Verification via multiple strategies: unit tests, property-based tests, cross-check harnesses, golden-file checks, and ROM-based conformance tests (optional if ROMs provided).

High-level Architecture
- Core (pure TypeScript)
  - cpu/: 65C816 (Ricoh 5A22) core, step/cycle accurate (targeting correctness first, refine timing later).
  - bus/: Memory map, LoROM/HiROM mapping, WRAM, DMA/HDMA skeleton.
  - ppu/: S-PPU1/2 registers, VRAM/CGRAM/OAM, scanline/dot counters, background/sprite pipeline (incremental).
  - apu/: SPC700 (S-SMP) + S-DSP; start with instruction correctness and IO ports; later integrate audio stream rendering.
  - cart/: Cartridge header parser, mapping configuration (LoROM/HiROM/ExHiROM, SRAM/Save-RAM).
  - input/: Controller state (polled), deterministic input injection for tests.
  - timing/: Master clock scheduler for CPU, PPU, APU, DMA events.
  - emulator/: Orchestrates reset, frame stepping, save/load state, serialization.
- Frontend (web)
  - Web canvas for video, WebAudio for sound, keyboard mapping to controller inputs.
  - Thin bridge translating core frame/audio buffers to web primitives.

Testing Strategy
1) CPU (65C816) correctness
   - Unit tests per addressing mode and instruction semantics (E-mode and Native mode; M/X width handling).
   - Property-based tests generating random flags/register/memory pre-states; compare to a declarative spec model.
   - Exhaustive decode table coverage (all opcodes marked implemented or explicitly unimplemented with tests).
   - Reset/interrupt sequence tests: vectors, SP init, P flags, mode transitions.
2) Bus/Cartridge/Memory map
   - Mapping tests for LoROM/HiROM: verify address translation for representative banks and mirrors.
   - WRAM/OAM/VRAM/CGRAM register access tests with legal/illegal sequences and invariants.
   - DMA/HDMA behavior unit tests (begin with register effects and memory copies; timing refinements later).
3) PPU
   - Register behavior tests for INIDISP/CGADD/CGDATA/OAMADDR/OAMDATA/VRAMADDR/VRAMDATA, etc.
   - Deterministic rendering unit tests: small patterns written to VRAM/CGRAM and expected BG/sprite fetch outcomes at specific dots.
   - Golden-image tests: headless renderer produces a pixel buffer; we hash buffers and compare to stored golden hashes.
4) APU (SPC700 + S-DSP)
   - SPC700 instruction semantics unit tests and property-based tests.
   - I/O port handshake tests between CPU and APU.
   - Deterministic DSP tests: write known sequences to DSP regs and validate output buffer checksum against goldens.
5) End-to-end deterministic tests
   - Boot test (dummy minimal ROM): verify reset vector, CPU fetches, and no illegal memory accesses.
   - Cartridge header parsing tests across synthetic headers (LoROM/HiROM variants).
   - SMW acceptance test (optional when ROM available via env var): load ROM, run for N frames with a scripted input pattern, assert
     - VRAM layer tilemap region hashes,
     - PPU register values at key scanlines,
     - APU DSP state/audio buffer checksum.
   - These tests are skipped if ROM env vars are not set, keeping CI green without distributing copyrighted ROMs.

External Test ROMs (optional, not bundled)
- If allowed/provided by the user, we can integrate community test ROMs for 65C816/PPU/APU conformance and use their pass/fail conventions.
- The repo will include a script to place/download these into test-roms/ (user-provided), and tests will detect and run them if present.

Determinism and Seeds
- Property-based tests use a fixed seed by default; CI can randomize seed but must print it on failure.
- The emulator core must not use non-deterministic APIs; timing is simulated, not wall-clock.

Performance vs Correctness
- Prioritize correctness; micro-optimizations later. Ensure clear traces/logging for any failing tests.

Work Plan (Milestones)
1) Bootstrap
   - Repo init, TypeScript, Vitest, ESLint+Prettier, basic CI (local script initially).
   - Document coding conventions and test patterns.
2) CPU core scaffolding
   - Registers/flags, memory interface, decode table stub, reset/interrupt framework, stack & pushes/pulls.
   - Unit tests: reset, stack ops, status flag transitions, addressing modes (a few), E vs Native mode basics.
3) CPU semantics and coverage
   - Implement ALU ops (ADC/SBC with decimal off first), loads/stores, transfers, branches/jumps, shifts/rotates, bit ops.
   - Property-based spec model; cross-check execution results.
   - Add decimal (BCD) behavior; NMI/IRQ entry and RTI.
4) Bus & cartridge mapping
   - WRAM, ROM mapping; LoROM/HiROM detect; vector fetch tests.
   - MMIO register file with stubs for PPU/APU.
5) DMA/HDMA basics
   - Implement general DMA transfers (A-B, addressing modes); unit tests against small buffers.
6) PPU registers & memory
   - Implement register side effects, VRAM/CGRAM/OAM access ports and address increment behavior.
   - Unit tests and first golden buffer tests for simple patterns.
7) PPU rendering pipeline (incremental)
   - BG layers and tile fetches; sprites; windowing and color math later.
   - Golden-image tests per feature increment.
8) APU (SPC700 + DSP)
   - SPC700 core with tests; DSP register model and simple audio synthesis; expand toward accuracy.
9) Emulator orchestration
   - Clock scheduler tying CPU/PPU/APU; frame stepping; save states; deterministic input injection.
10) Frontend (web)
   - Canvas renderer, WebAudio output, keyboard mapping.
   - End-to-end tests in headless mode using jsdom or NodeCanvas-like stubs.
11) SMW acceptance tests (conditional)
   - If SMW ROM path provided, run scripted frames and validate hashes.

Acceptance Criteria for “Ready to Run SMW”
- CPU: full opcode coverage with passing unit/property tests.
- Bus: LoROM/HiROM mapping validated; DMA basic coverage; interrupt timing approximated.
- PPU: register suite tests pass; basic BG/sprite rendering golden tests pass.
- APU: instruction and I/O tests pass; audio buffer checksum tests pass.
- End-to-end: scripted run on at least one known-good ROM (open test ROM) reaches expected state hash.
- SMW acceptance tests (if ROM provided) pass with consistent VRAM/PPU/DSP hash expectations for N frames.

Repository Structure (initial)
- src/
  - cpu/
  - bus/
  - ppu/
  - apu/
  - cart/
  - input/
  - timing/
  - emulator/
- tests/
  - cpu/
  - bus/
  - ppu/
  - apu/
  - emulator/
- scripts/
  - fetch-test-roms.ts (optional helper; disabled by default)
- docs/
  - EMULATOR_PLAN.md (this file)

Dev/CI Commands
- pnpm or npm scripts for: build, test, test:watch, lint, format.
- Tests must run headless and deterministically.

Notes
- We will not include copyrighted ROMs; tests relying on real ROMs are opt-in and skipped by default.
- As testing evolves, we can add benchmark fixtures and traces to improve timing accuracy.

