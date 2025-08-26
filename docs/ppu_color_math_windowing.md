# SNES PPU windowing and color math (simplified emulator model)

This document explains the simplified behavior modeled in this emulator for window selection, combine modes, subscreen gating, clip-to-black, and color math. It reflects the conventions used across our test suite.

Registers covered
- CGWSEL ($2130)
- CGADSUB ($2131)
- COLDATA ($2132)
- W12SEL ($2123)
- W34SEL ($2124)
- WOBJSEL ($2125)
- WH0..WH3 ($2126..$2129)

Window ranges (WH0..WH3)
- WH0 ($2126): Window A left (inclusive)
- WH1 ($2127): Window A right (inclusive)
- WH2 ($2128): Window B left (inclusive)
- WH3 ($2129): Window B right (inclusive)
- If left <= right, the window is a normal contiguous range.
- If left > right, the window wraps around the screen edge. For example, left=6, right=1 over an 8px-wide test pattern selects positions {6,7,0,1}.
- Boundaries are inclusive: x == left and x == right are inside.

Window selection per layer (simplified bit layout)
The emulator uses a compact bit layout for enabling A/B windows and their invert flags per layer:
- W12SEL ($2123): BG1 and BG2
  - BG1: enable A bit0 (0x01), enable B bit1 (0x02), invert A bit4 (0x10), invert B bit5 (0x20)
  - BG2: enable A bit2 (0x04), enable B bit3 (0x08), invert A bit6 (0x40), invert B bit7 (0x80)
- W34SEL ($2124): BG3 and BG4
  - BG3: enable A bit0 (0x01), enable B bit1 (0x02), invert A bit4 (0x10), invert B bit5 (0x20)
  - BG4: enable A bit2 (0x04), enable B bit3 (0x08), invert A bit6 (0x40), invert B bit7 (0x80)
- WOBJSEL ($2125): OBJ and subscreen/backdrop
  - OBJ: enable A bit0 (0x01), enable B bit1 (0x02), invert A bit4 (0x10), invert B bit5 (0x20)
  - Subscreen/backdrop gate: bit2 (0x04) — when CGWSEL subGate is on, this bit lets the window gate subscreen presence using Window A.

Combine modes (CGWSEL bits 6-7)
- 0: OR
- 1: AND
- 2: XOR
- 3: XNOR
These combine the (possibly inverted) A and B windows for each layer where both A and/or B are enabled for that layer.

Apply-inside vs outside (CGWSEL bit0)
- bit0 = 1: apply gating to pixels inside the combined window.
- bit0 = 0: apply gating to pixels outside the combined window.

Subscreen gate (CGWSEL bit1)
- When set, the subscreen can be masked by its window selection. This affects whether a subscreen pixel participates in color math.
- In this emulator, when subscreen is masked but color math is enabled for a main layer pixel, the blend behaves as if the subscreen pixel were black (backdrop). This can result in a “half-red” look when add-half is enabled with a red main layer and subscreen masked.

Fixed color as subscreen (CGWSEL bit2, COLDATA $2132)
- bit2 = 1 enables fixed-color mode for the subscreen.
- COLDATA ($2132): set which channels and the 5-bit intensity to use for the fixed color.
  - Bit5: affect red; Bit6: green; Bit7: blue. Low 5 bits are the 5-bit intensity.
- When subGate masks out the subscreen and fixed color mode is on, the fixed color participates in math instead of the normal subscreen pixel.

Clip-to-black vs prevent-math (CGWSEL bit3)
- When a pixel is on the “non-math” side of the main layer’s window gating decision:
  - If bit3 = 1 (clip-to-black): the output is forced to black immediately for that pixel.
  - If bit3 = 0 (prevent-math): the pixel is output without color math (pure main color).
- Tests verify this for BG4 and OBJs, including wrap-around windows.

Color math enable and masks (CGADSUB $2131)
- bit7: half math (add/sub divide-by-2)
- bit6: enable color math (1 = color math active for masked layers)
- bits0..4: mask selects which main layers are subject to color math
  - BG1=0x01, BG2=0x02, BG3=0x04, BG4=0x08, OBJ=0x10
- The emulator currently models add-half blending with optional fixed color and subscreen gating.

Brightness (INIDISP $2100)
- Brightness scaling is applied after color math in this emulator, as validated by the tests.

Practical tips from tests
- Wrap-around windows are heavily exercised: e.g., A[6..1] includes positions 6,7,0,1.
- XNOR combined with an invert flag on one window often behaves like XOR on the original, non-inverted windows — we have tests relying on this identity.
- Subscreen gating can be combined with main-layer gating; blending only occurs where the main layer is gated for math AND (when subGate is on) the subscreen is present (or replaced by fixed color if enabled).

Refer to tests under tests/ppu/ for concrete, self-contained setup examples that cover:
- Combine modes with and without invert flags
- Wrap-around edge cases for BG4 and OBJ
- Subscreen gating and fixed color usage
- Clip-to-black vs prevent-math behavior

