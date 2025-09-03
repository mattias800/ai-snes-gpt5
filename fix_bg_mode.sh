#!/bin/bash
# Add BG mode setting after brightness setting in tests

for file in tests/ppu/color_math*.ts tests/ppu/window*.ts tests/ppu/bg2*.ts tests/ppu/bg4*.ts tests/ppu/obj*.ts tests/ppu/fixed*.ts tests/ppu/hdma*.ts tests/ppu/subscreen*.ts tests/ppu/cgadsub*.ts tests/ppu/mixed*.ts tests/ppu/half*.ts tests/ppu/main*.ts; do
  if [ -f "$file" ]; then
    # Check if the file already has BG mode setting
    if ! grep -q "mmio(0x05)" "$file"; then
      # Add BG mode after brightness setting
      sed -i '' '/w8(bus, mmio(0x00), 0x0f);/a\
    // Set BG mode 1 (BG1\/2 are 4bpp, BG3 is 2bpp)\
    w8(bus, mmio(0x05), 0x01);
' "$file"
      echo "Fixed: $file"
    fi
  fi
done
