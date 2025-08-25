export type Button = 'B' | 'Y' | 'Select' | 'Start' | 'Up' | 'Down' | 'Left' | 'Right' | 'A' | 'X' | 'L' | 'R';

// SNES controller: 12 buttons serially shifted, order: B,Y,Select,Start,Up,Down,Left,Right,A,X,L,R (then 0s)
export class Controller {
  private state = new Set<Button>();
  private shiftIndex = 0;
  private strobe = 0; // 0 or 1

  setButton(button: Button, pressed: boolean) {
    if (pressed) this.state.add(button); else this.state.delete(button);
  }

  // Write to $4016 bit 0: strobe
  writeStrobe(value: number) {
    const bit = value & 1;
    this.strobe = bit;
    if (bit === 1) {
      // While strobe high, reading always returns B button state and resets shiftIndex
      this.shiftIndex = 0;
    } else {
      // Falling edge prepares to start shifting from first bit
      this.shiftIndex = 0;
    }
  }

  // Read from $4016/$4017: returns bit0 per current index; if strobe=0, advance
  readBit(): number {
    const order: Button[] = ['B', 'Y', 'Select', 'Start', 'Up', 'Down', 'Left', 'Right', 'A', 'X', 'L', 'R'];
    let bit = 0;
    if (this.shiftIndex < order.length) {
      bit = this.state.has(order[this.shiftIndex]) ? 1 : 0;
    } else {
      bit = 1; // open bus high typically; some docs suggest 1 for remaining reads
    }
    if (this.strobe === 0) {
      this.shiftIndex++;
    }
    return bit;
  }
}
