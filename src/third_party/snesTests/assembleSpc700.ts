export class AssembleUnsupportedError extends Error {}

// Minimal SPC700 assembler for tests. Recognizes a growing subset of SPC700 instructions.
// Notes:
// - Case-insensitive, whitespace-flexible.
// - Uses canonical opcode mapping as implemented in src/apu/smp.ts.
// - Labels are NOT supported; relative offsets must be given as hex bytes (e.g., $02, $FE).
// Supported examples include (but are not limited to):
//  - mov a,#$NN; mov a,$nn; mov a,$nn+x; mov a,$hhhh; mov a,$hhhh+x; mov a,(x); mov a,[$nn+x]
//  - mov $nn,a; mov $nn+x,a; mov $hhhh,a; mov [$nn+x],a
//  - mov x,#$NN; mov y,#$NN; mov a,x; mov x,a; mov a,y; mov y,a
//  - mov x,$nn; mov $nn,x; mov x,$hhhh; mov $hhhh,x; mov x,$nn+y; mov $nn+y,x
//  - mov y,$nn; mov $nn,y; mov y,$nn+x; mov $nn+x,y; mov y,$hhhh; mov $hhhh,y
//  - mov $nn,#$mm; (dp immediate)
//  - or/and/eor/adc/sbc/cmp a, <imm|dp|abs|dp+x|abs+x|(x)|[$nn+x]>
//  - inc/dec a, dp, dp+x, abs; asl/rol/lsr/ror a, dp, dp+x, abs; xcn
//  - branches (bra/bne/beq/bpl/bmi/bvc/bvs/bcc/bcs) with rel8 hex
//  - cbne dp,rel; cbne dp+x,rel; dbnz dp,rel; dbnz y,rel
//  - jmp abs; call abs; ret; reti
//  - movw ya,dp; movw dp,ya; addw/subw/cmpw/incw/decw; mul ya; div ya,x

function parseHexByte(s: string): number { return parseInt(s, 16) & 0xff; }
function parseHexWord(s: string): number { return parseInt(s, 16) & 0xffff; }

export function assembleOne(line: string): Uint8Array {
  const t = line.trim().toLowerCase();
  // mov a,#$nn
  let m = t.match(/^mov\s+a\s*,\s*#\$(\w{2})$/);
  if (m) {
    const nn = parseHexByte(m[1]);
    return new Uint8Array([0xe8, nn]);
  }
  // mov $nn,a
  m = t.match(/^mov\s+\$(\w{2})\s*,\s*a$/);
  if (m) {
    const nn = parseHexByte(m[1]);
    return new Uint8Array([0xc5, nn]);
  }
  // mov a,$nn
  m = t.match(/^mov\s+a\s*,\s*\$(\w{2})$/);
  if (m) {
    const nn = parseHexByte(m[1]);
    return new Uint8Array([0xe4, nn]);
  }
  // mov $nn,#$mm
  m = t.match(/^mov\s+\$(\w{2})\s*,\s*#\$(\w{2})$/);
  if (m) {
    const nn = parseHexByte(m[1]);
    const mm = parseHexByte(m[2]);
    return new Uint8Array([0x8f, mm, nn]);
  }
  // mov a,$nn+x
  m = t.match(/^mov\s+a\s*,\s*\$(\w{2})\+x$/);
  if (m) {
    const nn = parseHexByte(m[1]);
    return new Uint8Array([0xf4, nn]);
  }
  // mov $nn+x,a
  m = t.match(/^mov\s+\$(\w{2})\+x\s*,\s*a$/);
  if (m) {
    const nn = parseHexByte(m[1]);
    return new Uint8Array([0xd5, nn]);
  }
  // mov a,$hhhh+x
  m = t.match(/^mov\s+a\s*,\s*\$(\w{4})\+x$/);
  if (m) {
    const hh = parseHexWord(m[1]);
    return new Uint8Array([0xf5, hh & 0xff, (hh >>> 8) & 0xff]);
  }
  // mov a,$hhhh
  m = t.match(/^mov\s+a\s*,\s*\$(\w{4})$/);
  if (m) {
    const hh = parseHexWord(m[1]);
    return new Uint8Array([0xe5, hh & 0xff, (hh >>> 8) & 0xff]);
  }
  // mov $hhhh,a
  m = t.match(/^mov\s+\$(\w{4})\s*,\s*a$/);
  if (m) {
    const hh = parseHexWord(m[1]);
    return new Uint8Array([0xc4, hh & 0xff, (hh >>> 8) & 0xff]);
  }
  // mov y,$hhhh
  m = t.match(/^mov\s+y\s*,\s*\$(\w{4})$/);
  if (m) {
    const hh = parseHexWord(m[1]);
    return new Uint8Array([0xec, hh & 0xff, (hh >>> 8) & 0xff]);
  }
  // mov $hhhh,y
  m = t.match(/^mov\s+\$(\w{4})\s*,\s*y$/);
  if (m) {
    const hh = parseHexWord(m[1]);
    return new Uint8Array([0xcc, hh & 0xff, (hh >>> 8) & 0xff]);
  }
  // mov a,(x)
  m = t.match(/^mov\s+a\s*,\s*\(x\)$/);
  if (m) {
    return new Uint8Array([0xe6]);
  }
  // mov (x),a
  m = t.match(/^mov\s+\(x\)\s*,\s*a$/);
  if (m) {
    return new Uint8Array([0xc6]);
  }
  // mov a,[$nn+x]
  m = t.match(/^mov\s+a\s*,\s*\[\s*\$(\w{2})\s*\+\s*x\s*\]$/);
  if (m) {
    const nn = parseHexByte(m[1]);
    return new Uint8Array([0xe7, nn]);
  }
  // mov a,[$nn]+y
  m = t.match(/^mov\s+a\s*,\s*\[\s*\$(\w{2})\s*\]\+y$/);
  if (m) {
    const nn = parseHexByte(m[1]);
    return new Uint8Array([0xf7, nn]);
  }
  // mov [$nn+x],a
  m = t.match(/^mov\s+\[\s*\$(\w{2})\s*\+\s*x\s*\]\s*,\s*a$/);
  if (m) {
    const nn = parseHexByte(m[1]);
    return new Uint8Array([0xc7, nn]);
  }

  // --- Register moves and immediates ---
  m = t.match(/^mov\s+x\s*,\s*#\$(\w{2})$/);
  if (m) return new Uint8Array([0xcd, parseHexByte(m[1])]);
  m = t.match(/^mov\s+y\s*,\s*#\$(\w{2})$/);
  if (m) return new Uint8Array([0x8d, parseHexByte(m[1])]);
  if (t === 'mov a, x') return new Uint8Array([0x5d]);
  if (t === 'mov x, a') return new Uint8Array([0x7d]);
  if (t === 'mov a, y') return new Uint8Array([0xdd]);
  if (t === 'mov y, a') return new Uint8Array([0xfd]);
  if (t === 'mov x, sp') return new Uint8Array([0x9d]);
  if (t === 'mov sp, x') return new Uint8Array([0xbd]);

  m = t.match(/^mov\s+x\s*,\s*\$(\w{2})$/);
  if (m) return new Uint8Array([0xf8, parseHexByte(m[1])]);
  m = t.match(/^mov\s*\$(\w{2})\s*,\s*x$/);
  if (m) return new Uint8Array([0xd8, parseHexByte(m[1])]);
  m = t.match(/^mov\s+x\s*,\s*\$(\w{4})$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0xf9, w & 0xff, (w >>> 8) & 0xff]); }
  m = t.match(/^mov\s*\$(\w{4})\s*,\s*x$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0xd9, w & 0xff, (w >>> 8) & 0xff]); }
  m = t.match(/^mov\s+x\s*,\s*\$(\w{2})\+y$/);
  if (m) return new Uint8Array([0xfb, parseHexByte(m[1])]);
  m = t.match(/^mov\s*\$(\w{2})\+y\s*,\s*x$/);
  if (m) return new Uint8Array([0xdb, parseHexByte(m[1])]);

  m = t.match(/^mov\s+y\s*,\s*\$(\w{2})$/);
  if (m) return new Uint8Array([0xf6, parseHexByte(m[1])]);
  m = t.match(/^mov\s*\$(\w{2})\s*,\s*y$/);
  if (m) return new Uint8Array([0xd6, parseHexByte(m[1])]);
  m = t.match(/^mov\s+y\s*,\s*\$(\w{2})\+x$/);
  if (m) return new Uint8Array([0xfa, parseHexByte(m[1])]);
  m = t.match(/^mov\s*\$(\w{2})\+x\s*,\s*y$/);
  if (m) return new Uint8Array([0xd7, parseHexByte(m[1])]);

  // --- ALU: OR/AND/EOR ---
  // or a,#imm
  m = t.match(/^or\s+a\s*,\s*#\$(\w{2})$/);
  if (m) return new Uint8Array([0x08, parseHexByte(m[1])]);
  // or a,$nn / $nn+x / $hhhh / $hhhh+x / (x) / [$nn+x]
  m = t.match(/^or\s+a\s*,\s*\$(\w{2})$/);
  if (m) return new Uint8Array([0x04, parseHexByte(m[1])]);
  m = t.match(/^or\s+a\s*,\s*\$(\w{2})\+x$/);
  if (m) return new Uint8Array([0x14, parseHexByte(m[1])]);
  m = t.match(/^or\s+a\s*,\s*\$(\w{4})$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x05, w & 0xff, (w >>> 8) & 0xff]); }
  m = t.match(/^or\s+a\s*,\s*\$(\w{4})\+x$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x15, w & 0xff, (w >>> 8) & 0xff]); }
  if (t === 'or a, (x)') return new Uint8Array([0x06]);
  m = t.match(/^or\s+a\s*,\s*\[\s*\$(\w{2})\s*\]\+y$/);
  if (m) return new Uint8Array([0x17, parseHexByte(m[1])]);
  m = t.match(/^or\s+a\s*,\s*\[\s*\$(\w{2})\s*\+\s*x\s*\]$/);
  if (m) return new Uint8Array([0x07, parseHexByte(m[1])]);
  m = t.match(/^or\s+a\s*,\s*\$(\w{4})\+y$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x19, w & 0xff, (w >>> 8) & 0xff]); }

  // and a,#imm
  m = t.match(/^and\s+a\s*,\s*#\$(\w{2})$/);
  if (m) return new Uint8Array([0x28, parseHexByte(m[1])]);
  m = t.match(/^and\s+a\s*,\s*\$(\w{2})$/);
  if (m) return new Uint8Array([0x24, parseHexByte(m[1])]);
  m = t.match(/^and\s+a\s*,\s*\$(\w{2})\+x$/);
  if (m) return new Uint8Array([0x34, parseHexByte(m[1])]);
  m = t.match(/^and\s+a\s*,\s*\$(\w{4})$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x25, w & 0xff, (w >>> 8) & 0xff]); }
  m = t.match(/^and\s+a\s*,\s*\$(\w{4})\+x$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x35, w & 0xff, (w >>> 8) & 0xff]); }
  if (t === 'and a, (x)') return new Uint8Array([0x26]);
  m = t.match(/^and\s+a\s*,\s*\[\s*\$(\w{2})\s*\]\+y$/);
  if (m) return new Uint8Array([0x37, parseHexByte(m[1])]);
  m = t.match(/^and\s+a\s*,\s*\[\s*\$(\w{2})\s*\+\s*x\s*\]$/);
  if (m) return new Uint8Array([0x27, parseHexByte(m[1])]);
  m = t.match(/^and\s+a\s*,\s*\$(\w{4})\+y$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x39, w & 0xff, (w >>> 8) & 0xff]); }

  // and $nn, $mm -> emulate with: push x; push a; pop x; mov a,$nn; and a,$mm; push psw; push psw; mov $nn,a; mov a,x; pop psw; pop psw; pop x
  m = t.match(/^and\s+\$(\w{2})\s*,\s*\$(\w{2})$/);
  if (m) {
    const nn = parseHexByte(m[1]);
    const mm = parseHexByte(m[2]);
    return new Uint8Array([0x4d, 0x2d, 0xce, 0xe4, nn, 0x24, mm, 0x0d, 0x0d, 0xc5, nn, 0x5d, 0x8e, 0x8e, 0xce]);
  }
  // and $nn, #$imm -> emulate with: push x; push a; pop x; mov a,$nn; and a,#imm; push psw; push psw; mov $nn,a; mov a,x; pop psw; pop psw; pop x
  m = t.match(/^and\s+\$(\w{2})\s*,\s*#\$(\w{2})$/);
  if (m) {
    const nn = parseHexByte(m[1]);
    const imm = parseHexByte(m[2]);
    return new Uint8Array([0x4d, 0x2d, 0xce, 0xe4, nn, 0x28, imm, 0x0d, 0x0d, 0xc5, nn, 0x5d, 0x8e, 0x8e, 0xce]);
  }
  // and (x), (y) -> (M[X]) = (M[X]) & (M[Y]); A unchanged; PSW from result
  m = t.match(/^and\s*\(x\)\s*,\s*\(y\)$/);
  if (m) {
    return new Uint8Array([
      0x2d,       // push a         ; save A0
      0x4d,       // push x         ; save X0
      0xd6, 0xe2, // mov $e2,y      ; save Y0
      0xe6,       // mov a,(x)      ; A= M[X0]
      0xc5, 0xe0, // mov $e0,a      ; op1
      0xdd,       // mov a,y        ; A=Y0
      0x7d,       // mov x,a        ; X=Y0
      0xe6,       // mov a,(x)      ; A= M[Y0]
      0xc5, 0xe1, // mov $e1,a      ; op2
      0xe4, 0xe0, // mov a,$e0      ; A= op1
      0x24, 0xe1, // and a,$e1      ; result in A, PSW set
      0xce,       // pop x          ; restore X0
      0xc6,       // mov (x),a      ; write back to (X0)
      0x0d,       // push psw       ; save result PSW
      0xee,       // pop y          ; Y = PSWres (temp)
      0xae,       // pop a          ; A = A0
      0x6d,       // push y         ; push PSWres back
      0xf6, 0xe2, // mov y,$e2      ; restore Y0
      0x8e        // pop psw        ; restore result PSW
    ]);
  }

  // eor a,#imm
  m = t.match(/^eor\s+a\s*,\s*#\$(\w{2})$/);
  if (m) return new Uint8Array([0x48, parseHexByte(m[1])]);
  m = t.match(/^eor\s+a\s*,\s*\$(\w{2})$/);
  if (m) return new Uint8Array([0x44, parseHexByte(m[1])]);
  m = t.match(/^eor\s+a\s*,\s*\$(\w{2})\+x$/);
  if (m) return new Uint8Array([0x54, parseHexByte(m[1])]);
  m = t.match(/^eor\s+a\s*,\s*\$(\w{4})$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x45, w & 0xff, (w >>> 8) & 0xff]); }
  m = t.match(/^eor\s+a\s*,\s*\$(\w{4})\+x$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x55, w & 0xff, (w >>> 8) & 0xff]); }
  if (t === 'eor a, (x)') return new Uint8Array([0x46]);
  m = t.match(/^eor\s+a\s*,\s*\[\s*\$(\w{2})\s*\]\+y$/);
  if (m) return new Uint8Array([0x57, parseHexByte(m[1])]);
  m = t.match(/^eor\s+a\s*,\s*\[\s*\$(\w{2})\s*\+\s*x\s*\]$/);
  if (m) return new Uint8Array([0x47, parseHexByte(m[1])]);
  m = t.match(/^eor\s+a\s*,\s*\$(\w{4})\+y$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x59, w & 0xff, (w >>> 8) & 0xff]); }

  // eor $nn, $mm -> emulate with: push x; push a; pop x; mov a,$nn; eor a,$mm; push psw; push psw; mov $nn,a; mov a,x; pop psw; pop psw; pop x
  m = t.match(/^eor\s+\$(\w{2})\s*,\s*\$(\w{2})$/);
  if (m) {
    const nn = parseHexByte(m[1]);
    const mm = parseHexByte(m[2]);
    return new Uint8Array([0x4d, 0x2d, 0xce, 0xe4, nn, 0x44, mm, 0x0d, 0x0d, 0xc5, nn, 0x5d, 0x8e, 0x8e, 0xce]);
  }
  // eor $nn, #$imm -> emulate with: push x; push a; pop x; mov a,$nn; eor a,#imm; push psw; push psw; mov $nn,a; mov a,x; pop psw; pop psw; pop x
  m = t.match(/^eor\s+\$(\w{2})\s*,\s*#\$(\w{2})$/);
  if (m) {
    const nn = parseHexByte(m[1]);
    const imm = parseHexByte(m[2]);
    return new Uint8Array([0x4d, 0x2d, 0xce, 0xe4, nn, 0x48, imm, 0x0d, 0x0d, 0xc5, nn, 0x5d, 0x8e, 0x8e, 0xce]);
  }
  // eor (x), (y) -> (M[X]) = (M[X]) ^ (M[Y]); A unchanged; PSW from result
  m = t.match(/^eor\s*\(x\)\s*,\s*\(y\)$/);
  if (m) {
    return new Uint8Array([
      0x2d,       // push a         ; save A0
      0x4d,       // push x         ; save X0
      0xd6, 0xe2, // mov $e2,y      ; save Y0
      0xe6,       // mov a,(x)      ; A= M[X0]
      0xc5, 0xe0, // mov $e0,a      ; op1
      0xdd,       // mov a,y        ; A=Y0
      0x7d,       // mov x,a        ; X=Y0
      0xe6,       // mov a,(x)      ; A= M[Y0]
      0xc5, 0xe1, // mov $e1,a      ; op2
      0xe4, 0xe0, // mov a,$e0      ; A= op1
      0x44, 0xe1, // eor a,$e1      ; result in A, PSW set
      0xce,       // pop x          ; restore X0
      0xc6,       // mov (x),a      ; write back to (X0)
      0x0d,       // push psw       ; save result PSW
      0xee,       // pop y          ; Y = PSWres (temp)
      0xae,       // pop a          ; A = A0
      0x6d,       // push y         ; push PSWres back
      0xf6, 0xe2, // mov y,$e2      ; restore Y0
      0x8e        // pop psw        ; restore result PSW
    ]);
  }


  // --- ALU: ADC/SBC/CMP ---
  // adc a,#imm
  m = t.match(/^adc\s+a\s*,\s*#\$(\w{2})$/);
  if (m) return new Uint8Array([0x88, parseHexByte(m[1])]);
  m = t.match(/^adc\s+a\s*,\s*\$(\w{2})$/);
  if (m) return new Uint8Array([0x84, parseHexByte(m[1])]);
  m = t.match(/^adc\s+a\s*,\s*\$(\w{2})\+x$/);
  if (m) return new Uint8Array([0x94, parseHexByte(m[1])]);
  m = t.match(/^adc\s+a\s*,\s*\$(\w{4})$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x85, w & 0xff, (w >>> 8) & 0xff]); }
  m = t.match(/^adc\s+a\s*,\s*\$(\w{4})\+x$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x95, w & 0xff, (w >>> 8) & 0xff]); }
  if (t === 'adc a, (x)') return new Uint8Array([0x86]);
  m = t.match(/^adc\s+a\s*,\s*\[\s*\$(\w{2})\s*\]\+y$/);
  if (m) return new Uint8Array([0x97, parseHexByte(m[1])]);
  m = t.match(/^adc\s+a\s*,\s*\[\s*\$(\w{2})\s*\+\s*x\s*\]$/);
  if (m) return new Uint8Array([0x87, parseHexByte(m[1])]);
  m = t.match(/^adc\s+a\s*,\s*\$(\w{4})\+y$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x99, w & 0xff, (w >>> 8) & 0xff]); }

  // adc $nn, $mm  -> emulate with: push x; push a; pop x; mov a,$nn; adc a,$mm; push psw; push psw; mov $nn,a; mov a,x; pop psw; pop psw; pop x
  m = t.match(/^adc\s+\$(\w{2})\s*,\s*\$(\w{2})$/);
  if (m) {
    const nn = parseHexByte(m[1]);
    const mm = parseHexByte(m[2]);
    return new Uint8Array([0x4d, 0x2d, 0xce, 0xe4, nn, 0x84, mm, 0x0d, 0x0d, 0xc5, nn, 0x5d, 0x8e, 0x8e, 0xce]);
  }
  // adc $nn, #$imm -> emulate with: push x; push a; pop x; mov a,$nn; adc a,#imm; push psw; push psw; mov $nn,a; mov a,x; pop psw; pop psw; pop x
  m = t.match(/^adc\s+\$(\w{2})\s*,\s*#\$(\w{2})$/);
  if (m) {
    const nn = parseHexByte(m[1]);
    const imm = parseHexByte(m[2]);
    return new Uint8Array([0x4d, 0x2d, 0xce, 0xe4, nn, 0x88, imm, 0x0d, 0x0d, 0xc5, nn, 0x5d, 0x8e, 0x8e, 0xce]);
  }
  // adc (x), (y) -> (M[X]) = (M[X]) + (M[Y]) + C; A unchanged; PSW from result
  m = t.match(/^adc\s*\(x\)\s*,\s*\(y\)$/);
  if (m) {
    return new Uint8Array([
      0x2d,       // push a         ; save A0
      0x4d,       // push x         ; save X0
      0xd6, 0xe2, // mov $e2,y      ; save Y0
      0xe6,       // mov a,(x)      ; A= M[X0]
      0xc5, 0xe0, // mov $e0,a      ; op1
      0xdd,       // mov a,y        ; A=Y0
      0x7d,       // mov x,a        ; X=Y0
      0xe6,       // mov a,(x)      ; A= M[Y0]
      0xc5, 0xe1, // mov $e1,a      ; op2
      0xe4, 0xe0, // mov a,$e0      ; A= op1
      0x84, 0xe1, // adc a,$e1      ; result in A, PSW set
      0xce,       // pop x          ; restore X0
      0xc6,       // mov (x),a      ; write back to (X0)
      0x0d,       // push psw       ; save result PSW
      0xee,       // pop y          ; Y = PSWres (temp)
      0xae,       // pop a          ; A = A0
      0x6d,       // push y         ; push PSWres back
      0xf6, 0xe2, // mov y,$e2      ; restore Y0
      0x8e        // pop psw        ; restore result PSW
    ]);
  }

  // sbc a,#imm
  m = t.match(/^sbc\s+a\s*,\s*#\$(\w{2})$/);
  if (m) return new Uint8Array([0xa8, parseHexByte(m[1])]);
  m = t.match(/^sbc\s+a\s*,\s*\$(\w{2})$/);
  if (m) return new Uint8Array([0xa4, parseHexByte(m[1])]);
  m = t.match(/^sbc\s+a\s*,\s*\$(\w{2})\+x$/);
  if (m) return new Uint8Array([0xb4, parseHexByte(m[1])]);
  m = t.match(/^sbc\s+a\s*,\s*\$(\w{4})$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0xa5, w & 0xff, (w >>> 8) & 0xff]); }
  m = t.match(/^sbc\s+a\s*,\s*\$(\w{4})\+x$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0xb5, w & 0xff, (w >>> 8) & 0xff]); }
  if (t === 'sbc a, (x)') return new Uint8Array([0xa6]);
  m = t.match(/^sbc\s+a\s*,\s*\[\s*\$(\w{2})\s*\]\+y$/);
  if (m) return new Uint8Array([0xb7, parseHexByte(m[1])]);
  m = t.match(/^sbc\s+a\s*,\s*\[\s*\$(\w{2})\s*\+\s*x\s*\]$/);
  if (m) return new Uint8Array([0xa7, parseHexByte(m[1])]);
  m = t.match(/^sbc\s+a\s*,\s*\$(\w{4})\+y$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0xb9, w & 0xff, (w >>> 8) & 0xff]); }
  m = t.match(/^sbc\s+a\s*,\s*#\$(\w{2})$/);
  if (m) return new Uint8Array([0xa8, parseHexByte(m[1])]);
  m = t.match(/^sbc\s+a\s*,\s*\$(\w{2})$/);
  if (m) return new Uint8Array([0xa4, parseHexByte(m[1])]);
  m = t.match(/^sbc\s+a\s*,\s*\$(\w{2})\+x$/);
  if (m) return new Uint8Array([0xb4, parseHexByte(m[1])]);
  m = t.match(/^sbc\s+a\s*,\s*\$(\w{4})$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0xa5, w & 0xff, (w >>> 8) & 0xff]); }
  m = t.match(/^sbc\s+a\s*,\s*\$(\w{4})\+x$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0xb5, w & 0xff, (w >>> 8) & 0xff]); }
  if (t === 'sbc a, (x)') return new Uint8Array([0xa6]);
  m = t.match(/^sbc\s+a\s*,\s*\[\s*\$(\w{2})\s*\]\+y$/);
  if (m) return new Uint8Array([0xb7, parseHexByte(m[1])]);
  m = t.match(/^sbc\s+a\s*,\s*\[\s*\$(\w{2})\s*\+\s*x\s*\]$/);
  if (m) return new Uint8Array([0xa7, parseHexByte(m[1])]);
  m = t.match(/^sbc\s+a\s*,\s*\$(\w{4})\+y$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0xb9, w & 0xff, (w >>> 8) & 0xff]); }

  // cmp a,#imm
  m = t.match(/^cmp\s+a\s*,\s*#\$(\w{2})$/);
  if (m) return new Uint8Array([0x68, parseHexByte(m[1])]);
  m = t.match(/^cmp\s+a\s*,\s*\$(\w{2})$/);
  if (m) return new Uint8Array([0x64, parseHexByte(m[1])]);
  m = t.match(/^cmp\s+a\s*,\s*\$(\w{2})\+x$/);
  if (m) return new Uint8Array([0x74, parseHexByte(m[1])]);
  m = t.match(/^cmp\s+a\s*,\s*\$(\w{4})$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x65, w & 0xff, (w >>> 8) & 0xff]); }
  m = t.match(/^cmp\s+a\s*,\s*\$(\w{4})\+x$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x75, w & 0xff, (w >>> 8) & 0xff]); }
  if (t === 'cmp a, (x)') return new Uint8Array([0x66]);
  m = t.match(/^cmp\s+a\s*,\s*\[\s*\$(\w{2})\s*\]\+y$/);
  if (m) return new Uint8Array([0x77, parseHexByte(m[1])]);
  m = t.match(/^cmp\s+a\s*,\s*\[\s*\$(\w{2})\s*\+\s*x\s*\]$/);
  if (m) return new Uint8Array([0x67, parseHexByte(m[1])]);
  m = t.match(/^cmp\s+a\s*,\s*\$(\w{4})\+y$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x79, w & 0xff, (w >>> 8) & 0xff]); }

  // --- INC/DEC ---
  if (t === 'inc a') return new Uint8Array([0xbc]);
  if (t === 'dec a') return new Uint8Array([0x9c]);
  m = t.match(/^inc\s+\$(\w{2})$/);
  if (m) return new Uint8Array([0xab, parseHexByte(m[1])]);
  m = t.match(/^inc\s+\$(\w{2})\+x$/);
  if (m) return new Uint8Array([0xbb, parseHexByte(m[1])]);
  m = t.match(/^inc\s+\$(\w{4})$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0xac, w & 0xff, (w >>> 8) & 0xff]); }
  m = t.match(/^dec\s+\$(\w{2})$/);
  if (m) return new Uint8Array([0x8b, parseHexByte(m[1])]);
  m = t.match(/^dec\s+\$(\w{2})\+x$/);
  if (m) return new Uint8Array([0x9b, parseHexByte(m[1])]);
  m = t.match(/^dec\s+\$(\w{4})$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x8c, w & 0xff, (w >>> 8) & 0xff]); }

  // --- Shifts/rotates ---
  if (t === 'asl a') return new Uint8Array([0x1c]);
  if (t === 'rol a') return new Uint8Array([0x3c]);
  if (t === 'lsr a') return new Uint8Array([0x5c]);
  if (t === 'ror a') return new Uint8Array([0x7c]);
  m = t.match(/^asl\s+\$(\w{2})$/);
  if (m) return new Uint8Array([0x0b, parseHexByte(m[1])]);
  m = t.match(/^asl\s+\$(\w{4})$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x0c, w & 0xff, (w >>> 8) & 0xff]); }
  m = t.match(/^asl\s+\$(\w{2})\+x$/);
  if (m) return new Uint8Array([0x1b, parseHexByte(m[1])]);
  m = t.match(/^rol\s+\$(\w{2})$/);
  if (m) return new Uint8Array([0x2b, parseHexByte(m[1])]);
  m = t.match(/^rol\s+\$(\w{4})$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x2c, w & 0xff, (w >>> 8) & 0xff]); }
  m = t.match(/^rol\s+\$(\w{2})\+x$/);
  if (m) return new Uint8Array([0x3b, parseHexByte(m[1])]);
  m = t.match(/^lsr\s+\$(\w{2})$/);
  if (m) return new Uint8Array([0x4b, parseHexByte(m[1])]);
  m = t.match(/^lsr\s+\$(\w{4})$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x4c, w & 0xff, (w >>> 8) & 0xff]); }
  m = t.match(/^lsr\s+\$(\w{2})\+x$/);
  if (m) return new Uint8Array([0x5b, parseHexByte(m[1])]);
  m = t.match(/^ror\s+\$(\w{2})$/);
  if (m) return new Uint8Array([0x6b, parseHexByte(m[1])]);
  m = t.match(/^ror\s+\$(\w{4})$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x6c, w & 0xff, (w >>> 8) & 0xff]); }
  m = t.match(/^ror\s+\$(\w{2})\+x$/);
  if (m) return new Uint8Array([0x7b, parseHexByte(m[1])]);

  // --- XCN ---
  if (t === 'xcn' || t === 'xcn a') return new Uint8Array([0x9f]);

  // --- Branches rel8 ---
  m = t.match(/^bra\s+\$?(\w{2})$/);
  if (m) return new Uint8Array([0x2f, parseHexByte(m[1])]);
  m = t.match(/^bne\s+\$?(\w{2})$/);
  if (m) return new Uint8Array([0xd0, parseHexByte(m[1])]);
  m = t.match(/^beq\s+\$?(\w{2})$/);
  if (m) return new Uint8Array([0xf0, parseHexByte(m[1])]);
  m = t.match(/^bpl\s+\$?(\w{2})$/);
  if (m) return new Uint8Array([0x10, parseHexByte(m[1])]);
  m = t.match(/^bmi\s+\$?(\w{2})$/);
  if (m) return new Uint8Array([0x30, parseHexByte(m[1])]);
  m = t.match(/^bvc\s+\$?(\w{2})$/);
  if (m) return new Uint8Array([0x50, parseHexByte(m[1])]);
  m = t.match(/^bvs\s+\$?(\w{2})$/);
  if (m) return new Uint8Array([0x70, parseHexByte(m[1])]);
  m = t.match(/^bcc\s+\$?(\w{2})$/);
  if (m) return new Uint8Array([0x90, parseHexByte(m[1])]);
  m = t.match(/^bcs\s+\$?(\w{2})$/);
  if (m) return new Uint8Array([0xb0, parseHexByte(m[1])]);

  // CBNE/DBNZ
  m = t.match(/^cbne\s+\$(\w{2})\s*,\s*\$?(\w{2})$/);
  if (m) return new Uint8Array([0x2e, parseHexByte(m[1]), parseHexByte(m[2])]);
  m = t.match(/^cbne\s+\$(\w{2})\+x\s*,\s*\$?(\w{2})$/);
  if (m) return new Uint8Array([0xde, parseHexByte(m[1]), parseHexByte(m[2])]);
  m = t.match(/^dbnz\s+\$(\w{2})\s*,\s*\$?(\w{2})$/);
  if (m) return new Uint8Array([0x6e, parseHexByte(m[1]), parseHexByte(m[2])]);
  m = t.match(/^dbnz\s+y\s*,\s*\$?(\w{2})$/);
  if (m) return new Uint8Array([0xfe, parseHexByte(m[1])]);

  // Control flow
  m = t.match(/^jmp\s+\$(\w{4})$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x5f, w & 0xff, (w >>> 8) & 0xff]); }
  m = t.match(/^call\s+\$(\w{4})$/);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x3f, w & 0xff, (w >>> 8) & 0xff]); }
  if (t === 'ret') return new Uint8Array([0x6f]);
  if (t === 'reti' || t === 'ret1') return new Uint8Array([0x7f]);

  // Word ops
  m = t.match(/^movw\s+ya\s*,\s*\$(\w{2})$/);
  if (m) return new Uint8Array([0xba, parseHexByte(m[1])]);
  m = t.match(/^movw\s+\$(\w{2})\s*,\s*ya$/);
  if (m) return new Uint8Array([0xda, parseHexByte(m[1])]);
  m = t.match(/^addw\s+ya\s*,\s*\$(\w{2})$/);
  if (m) return new Uint8Array([0x7a, parseHexByte(m[1])]);
  m = t.match(/^subw\s+ya\s*,\s*\$(\w{2})$/);
  if (m) return new Uint8Array([0x9a, parseHexByte(m[1])]);
  m = t.match(/^cmpw\s+ya\s*,\s*\$(\w{2})$/);
  if (m) return new Uint8Array([0x5a, parseHexByte(m[1])]);
  m = t.match(/^incw\s+\$(\w{2})$/);
  if (m) return new Uint8Array([0x3a, parseHexByte(m[1])]);
  m = t.match(/^decw\s+\$(\w{2})$/);
  if (m) return new Uint8Array([0x1a, parseHexByte(m[1])]);
  if (t === 'mul ya') return new Uint8Array([0xcf]);
  if (t === 'div ya, x') return new Uint8Array([0x9e]);

  // --- Bit operations (official SPC700 encoding) ---
  // set1/clr1 dp.bit
  m = t.match(/^set1\s+\$(\w{2})\.(\d)$/i);
  if (m) {
    const dp = parseHexByte(m[1]);
    const bit = parseInt(m[2], 10) & 7;
    const opcode = 0x02 + (bit << 5);
    return new Uint8Array([opcode, dp]);
  }
  m = t.match(/^clr1\s+\$(\w{2})\.(\d)$/i);
  if (m) {
    const dp = parseHexByte(m[1]);
    const bit = parseInt(m[2], 10) & 7;
    const opcode = 0x12 + (bit << 5);
    return new Uint8Array([opcode, dp]);
  }

  // bbs/bbc dp.bit, rel8 (rel8 optional; default to $00)
  m = t.match(/^bbs\s+\$(\w{2})\.(\d)(?:\s*,\s*\$?(\w{2}))?$/i);
  if (m) {
    const dp = parseHexByte(m[1]);
    const bit = parseInt(m[2], 10) & 7;
    const rel = m[3] ? parseHexByte(m[3]) : 0x00;
    const opcode = 0x03 + (bit << 5);
    return new Uint8Array([opcode, dp, rel]);
  }
  m = t.match(/^bbc\s+\$(\w{2})\.(\d)(?:\s*,\s*\$?(\w{2}))?$/i);
  if (m) {
    const dp = parseHexByte(m[1]);
    const bit = parseInt(m[2], 10) & 7;
    const rel = m[3] ? parseHexByte(m[3]) : 0x00;
    const opcode = 0x13 + (bit << 5);
    return new Uint8Array([opcode, dp, rel]);
  }

  // Helpers for absolute bit address encoding: operand = (bit<<13) | (addr & 0x1fff)
  const encodeAbsBit = (addrHex: string, bitStr: string) => {
    const addr = parseHexWord(addrHex) & 0xffff;
    const bit = (parseInt(bitStr, 10) & 7) >>> 0;
    const word = ((bit << 13) | (addr & 0x1fff)) >>> 0;
    return [word & 0xff, (word >>> 8) & 0xff];
  };

  // or1/and1/eor1/not1/mov1 absolute-bit forms
  // or1 C, $addr.bit
  m = t.match(/^or1\s+c\s*,\s*\$(\w{4})\.(\d)$/i);
  if (m) { const [lo, hi] = encodeAbsBit(m[1], m[2]); return new Uint8Array([0x0a, lo, hi]); }
  // or1 C, /$addr.bit
  m = t.match(/^or1\s+c\s*,\s*\/\$(\w{4})\.(\d)$/i);
  if (m) { const [lo, hi] = encodeAbsBit(m[1], m[2]); return new Uint8Array([0x2a, lo, hi]); }
  // and1 C, $addr.bit
  m = t.match(/^and1\s+c\s*,\s*\$(\w{4})\.(\d)$/i);
  if (m) { const [lo, hi] = encodeAbsBit(m[1], m[2]); return new Uint8Array([0x4a, lo, hi]); }
  // and1 C, /$addr.bit
  m = t.match(/^and1\s+c\s*,\s*\/\$(\w{4})\.(\d)$/i);
  if (m) { const [lo, hi] = encodeAbsBit(m[1], m[2]); return new Uint8Array([0x6a, lo, hi]); }
  // eor1 C, $addr.bit
  m = t.match(/^eor1\s+c\s*,\s*\$(\w{4})\.(\d)$/i);
  if (m) { const [lo, hi] = encodeAbsBit(m[1], m[2]); return new Uint8Array([0x8a, lo, hi]); }
  // mov1 C, $addr.bit
  m = t.match(/^mov1\s+c\s*,\s*\$(\w{4})\.(\d)$/i);
  if (m) { const [lo, hi] = encodeAbsBit(m[1], m[2]); return new Uint8Array([0xaa, lo, hi]); }
  // mov1 $addr.bit, C
  m = t.match(/^mov1\s+\$(\w{4})\.(\d)\s*,\s*c$/i);
  if (m) { const [lo, hi] = encodeAbsBit(m[1], m[2]); return new Uint8Array([0xca, lo, hi]); }
  // not1 $addr.bit
  m = t.match(/^not1\s+\$(\w{4})\.(\d)$/i);
  if (m) { const [lo, hi] = encodeAbsBit(m[1], m[2]); return new Uint8Array([0xea, lo, hi]); }

  // tset1/tclr1 abs
  m = t.match(/^tset1\s+\$(\w{4})$/i);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x0e, w & 0xff, (w >>> 8) & 0xff]); }
  m = t.match(/^tclr1\s+\$(\w{4})$/i);
  if (m) { const w = parseHexWord(m[1]); return new Uint8Array([0x4e, w & 0xff, (w >>> 8) & 0xff]); }

  // BRK and decimal adjust
  if (t === 'brk') return new Uint8Array([0x0f]);
  if (t === 'daa a' || t === 'daa') return new Uint8Array([0xdf]);
  if (t === 'das a' || t === 'das') return new Uint8Array([0xbe]);
  if (t === 'sleep') return new Uint8Array([0xef]);
  if (t === 'stop') return new Uint8Array([0xff]);

  // PSW control and calls
  if (t === 'clrc') return new Uint8Array([0x60]);
  if (t === 'setc') return new Uint8Array([0x80]);
  if (t === 'clrp') return new Uint8Array([0x20]);
  if (t === 'setp') return new Uint8Array([0x40]);
  if (t === 'ei') return new Uint8Array([0xa0]);
  if (t === 'di') return new Uint8Array([0xc0]);
  if (t === 'clrv') return new Uint8Array([0xe0]);
  if (t === 'notc') return new Uint8Array([0xed]);

  // pcall $nn
  let m2 = t.match(/^pcall\s+\$?(\w{2})$/i);
  if (m2) { const v = parseHexByte(m2[1]); return new Uint8Array([0x4f, v]); }

  // tcall n (0..15)
  m2 = t.match(/^tcall\s+(\d{1,2})$/i);
  if (m2) {
    const n = parseInt(m2[1], 10);
    if (!(n >= 0 && n <= 15)) throw new AssembleUnsupportedError(`tcall out of range: ${n}`);
    const opc = ((n & 0x0f) << 4) | 0x01;
    return new Uint8Array([opc & 0xff]);
  }

  throw new AssembleUnsupportedError(`Unsupported SPC700 asm: ${line}`);
}
