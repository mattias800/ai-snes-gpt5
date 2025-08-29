# SNES PPU timing (scaffold for cycle-accurate implementation)

Status: scaffold

Scope
- Establish the timing model and acceptance tests for a dot-accurate SNES PPU. This document tracks constants, register timing semantics, and what our tests verify.

Timing model (NTSC)
- Frame: 262 scanlines (0..261).
- Horizontal: model as “dots” per line, with HBlank/VBlank boundaries defined at exact dot positions.
- Master clock relationships and exact dot counts are referenced from public documents (e.g., fullsnes, anomie). We will validate concrete constants against timing ROMs during implementation and record them here.

Initial constants (to be validated)
- Dots per scanline: TBD (placeholder during scaffold).
- Visible dot range: [TBD..TBD].
- HBlank start/end dots: TBD.
- VBlank start line: 224; end line: TBD. We currently use 224..261 for coarse tests; will be refined to exact edges.

Registers and timing semantics to cover
- $4212 (HVBJOY):
  - bit7 VBlank, bit6 HBlank. Must toggle on exact dot/line boundaries.
- $2137 (SLHV):
  - Latches the H/V counters. Latched values are returned by $213C/$213D (H) and $213E/$213F (V) until the high byte is read.
- $213C/$213D (OPHCT low/high), $213E/$213F (OPVCT low/high):
  - Live counters when not latched. Implement the internal low/high read toggle.
- VRAM ports ($2115 VMAIN, $2116/$2117 VMADD, $2118/$2119 VMDATA, $2139/$213A VMDATAL/VMDAH read):
  - Two-phase buffering, increment-after-low/high, step sizes, and address remap modes.
- CGRAM ports ($2121 CGADD, $2122 CGDATA, $213B CGREAD):
  - Two-phase low/high write, increment rules, and read increment behavior.
- OAM ports ($2102/$2103 OAMADDL/H, $2104 OAMDATA, $2138 OAMREAD):
  - Interleaving and increment-on-phase semantics, mirroring quirks.
- Per-dot pipelines:
  - BG fetch cadence and pixel FIFOs (modes 0/1/2/3/4 initially), OBJ evaluation (32 sprites/line, 34 tiles bandwidth), windowing and color math gating per dot, brightness per-dot.

Test plan (to be added under tests/ppu/timing)
- hvbjoy_edges.test.ts: Verify H/V blank edges via per-dot stepping.
- hv_latch_and_counters.test.ts: Verify $2137 latch and counter reads.
- vram_port_latency_and_modes.test.ts: Verify VRAM buffering and increment modes.
- cgram_two_phase.test.ts: Verify CGRAM write/read phases and increments.
- oam_port_interleave.test.ts: Verify OAM table interleaving and increments.
- mid_scanline_effects.test.ts: Verify impact of mid-line register writes at the correct dot boundaries.
- sprite_eval_limits.test.ts: Verify 32 sprites/line and 34 tiles bandwidth behavior.
- color_math_window_dot_gating.test.ts: Per-dot windowing and color math gating.
- trace_smoke.test.ts: Deterministic per-dot trace capture for debugging.

Acceptance
- New timing tests pass deterministically.
- Existing logic-level tests remain green by default (timing core is opt-in in tests).
- Constants and semantics documented here are updated as tests solidify.

Roadmap to cycle accuracy (implementation plan)
Milestone 1 — Finalize timing constants and edges
- Implement precise NTSC timing constants (dots per line, visible start/end, exact HBlank start/end dots, VBlank start dot/line) in src/timing/ntsc.ts.
- Wire NMI pulse exactly at VBlank start in TimingScheduler via onVBlankStart; ensure $4210 latch behavior remains correct.
- Tests:
  - tests/ppu/timing/hvbjoy_edges.test.ts (VBlank), hvbjoy_edges_hblank.test.ts (HBlank), hvbjoy_bus_bridge.test.ts (bus reflects timing PPU).
  - nmi_edges.test.ts (new): NMI fired once per frame at VBlank start; $4210 clears on read.
- Acceptance: All edge tests pass and are stable across runs.

Milestone 2 — VRAM address remap modes
- Add VMAIN bit2-3 address remap (2/4/8-bit mapping) helpers; apply to read/write paths of $2118/$2119 and $2139/$213A.
- Tests:
  - vram_remap_modes.test.ts: craft VRAM patterns and verify byte addressing under each remap mode with tile decode checks.
- Acceptance: All modes return expected indices for representative addresses.

Milestone 3 — OAM port interleaving quirks
- Implement two-phase OAMDATA write behavior and table interleaving; mirror quirks as needed for tests; preserve current simple behavior when timing not used.
- Tests:
  - oam_port_interleave.test.ts (expand): include interleaving across boundaries and verification against readback.
- Acceptance: Sequences produce expected OAM layout and reads.

Milestone 4 — BG pipelines (modes 0/1/2/3/4), screen sizes, 16×16 tiles
- Implement per-dot fetch cadence and line FIFOs for BG2–BG4 mirroring BG1 scaffolding.
- Support screen sizes (32×32/64×32/32×64/64×64) and 16×16 tiles (subtile mapping).
- Apply mid-scanline register effects at 8-pixel boundaries consistently across BGs.
- Tests:
  - mid_scanline_effects.test.ts (expand for BG2–BG4), bg_screensize_64.test.ts, bg_tiles_16x16_timing.test.ts.
- Acceptance: Per-dot pixels match region renders at dot resolution; boundary rules hold.

Milestone 5 — OBJ evaluation and bandwidth limits
- Per-scanline sprite evaluation (max 32 visible sprites), collect draw list in OAM order.
- Enforce 34 tile fetch limit per scanline (late OBJ tiles drop to transparent when bandwidth exceeded).
- Tests:
  - sprite_eval_limits.test.ts (32 sprite cap and 34 tiles bandwidth), obj_priority_timing.test.ts (overlay timing vs BGs).
- Acceptance: Limits and priorities match expectations across targeted cases.

Milestone 6 — Windowing and color math per-dot
- Implement window A/B per-layer gates, combine modes (OR/AND/XOR/XNOR), invert flags; apply-inside/outside (CGWSEL bit0); subscreen gate (bit1) and fixed color (bit2); clip-to-black vs prevent-math (bit3).
- Perform main/sub selection, window gating, and math per dot; brightness applied post-math.
- Tests (port existing expectations to dot domain):
  - color_math_window_dot_gating.test.ts (wrap-around, invert, combine), subscreen_gating_fixed_color_dot.test.ts, clip_vs_prevent_dot.test.ts.
- Acceptance: Per-dot results match existing logic-level results when integrated over scanlines.

Milestone 7 — Exact $213x counter nuances and read toggles
- Ensure low/high read toggles and latch-clear semantics exactly match hardware corner cases (repeated low reads unaffected, high read clears, write to $2137 mid-read behavior).
- Tests: hv_latch_and_counters.test.ts (expand with additional sequences).
- Acceptance: All toggling sequences pass.

Milestone 8 — Performance and determinism
- Add skipped micro-bench tests to ensure a 256×224 frame steps under a CI-friendly budget.
- Property tests: randomized window configurations vs reference per-dot gating; randomized VMAIN modes vs remap helper.
- Acceptance: Deterministic outputs; performance budget not exceeded in Node CI.

Milestone 9 — Extended features (post-core)
- Mosaic timing, Mode 7 scanline/dot model, interlace/hires behavior (if targeted by project scope).
- Add opt-in third-party timing ROM harness (RUN_SNES_PPU_TESTS=1) to validate against community ROMs.
- Acceptance: ROM harness passes targeted subsets and remains optional.

Execution notes
- Keep timing PPU opt-in in tests; legacy path remains default.
- Each milestone comes with tests added under tests/ppu/timing/** and doc updates here.
- Avoid regressions: do not change default renderer behavior or signatures without tests guarding it.

