#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import { Cartridge } from '../src/cart/cartridge.ts';
import { normaliseRom } from '../src/cart/loader.ts';
import { Emulator } from '../src/emulator/core.ts';
import { parseHeader } from '../src/cart/header.ts';

type TraceItem =
  | { kind: 'pc'; step: number; PBR: number; PC: number; raw: string }
  | { kind: 'loop'; count: number; raw: string };

function arg(name: string, def?: string) {
  const pref = `--${name}=`;
  for (const a of process.argv.slice(2)) if (a.startsWith(pref)) return a.slice(pref.length);
  return def;
}

function parseMameTraceLine(line: string): { PBR: number; PC: number } | null {
  // MAME trace observed format (no opcode bytes in this build): "00:8000: xce" or "00:8003: rep #$18"
  const m = line.match(/^\s*([0-9A-Fa-f]{2}):([0-9A-Fa-f]{4}):\s+/);
  if (!m) return null;
  const PBR = parseInt(m[1], 16) & 0xff;
  const PC = parseInt(m[2], 16) & 0xffff;
  return { PBR, PC };
}

function parseMameLoopLine(line: string): number | null {
  // Lines like: "   (loops for 86 instructions)"
  const m = line.match(/\(\s*loops\s+for\s+(\d+)\s+instructions\s*\)/i);
  if (!m) return null;
  return Number(m[1]) | 0;
}

function loadMameTrace(filePath: string, maxPcItems: number): TraceItem[] {
  const raw = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const out: TraceItem[] = [];
  let step = 0;
  let pcCount = 0;
  for (const line of raw) {
    const p = parseMameTraceLine(line);
    if (p) {
      out.push({ kind: 'pc', step, PBR: p.PBR, PC: p.PC, raw: line });
      step++;
      pcCount++;
      if (maxPcItems > 0 && pcCount >= maxPcItems) break;
      continue;
    }
    const loopCount = parseMameLoopLine(line);
    if (loopCount && loopCount > 0) {
      out.push({ kind: 'loop', count: loopCount, raw: line });
    }
  }
  return out;
}

function hex(n: number, w: number) { return (n >>> 0).toString(16).toUpperCase().padStart(w, '0'); }

function snapshot(cpu: any) {
  return {
    A: cpu.state.A & 0xffff,
    X: cpu.state.X & 0xffff,
    Y: cpu.state.Y & 0xffff,
    S: cpu.state.S & 0xffff,
    D: cpu.state.D & 0xffff,
    DBR: cpu.state.DBR & 0xff,
    PBR: cpu.state.PBR & 0xff,
    PC: cpu.state.PC & 0xffff,
    P: cpu.state.P & 0xff,
    E: !!cpu.state.E,
  };
}

function main() {
  const romPath = arg('rom');
  const tracePath = arg('trace');
  const maxSteps = Number(arg('max', '200000')!);
  const resyncWin = Math.max(0, Number(arg('resync', '128')!));
  const quiet = /^\s*(1|true|yes)\s*$/i.test((arg('quiet', '0') ?? '0'));
  // Allow tuning of how aggressively we try to step through collapsed MAME "(loops for N instructions)" blocks.
  const loopMult = Math.max(1, Number(arg('loopMult', '64')!));
  const loopHardMax = Math.max(1, Number(arg('loopHardMax', '2000000')!));
  if (!romPath || !tracePath) {
    console.error('Usage: tsx scripts/compare_against_mame.ts --rom=path/to.rom --trace=trace.log [--max=200000] [--resync=128] [--loopMult=64] [--loopHardMax=2000000]');
    process.exit(2);
  }

  const trace = loadMameTrace(path.resolve(tracePath), maxSteps);
  if (trace.length === 0) {
    console.error('No trace lines parsed from', tracePath);
    process.exit(3);
  }
  const firstPcIdx = trace.findIndex(t => t.kind === 'pc');
  if (firstPcIdx < 0) {
    console.error('Trace contained no executable PC lines');
    process.exit(3);
  }

  const romData = fs.readFileSync(path.resolve(romPath));
  const { rom } = normaliseRom(new Uint8Array(romData));
  const header = parseHeader(rom);
  const cart = new Cartridge({ rom, mapping: header.mapping });

  // Configure CPU-only compare mode helpers: ensure initial RDNMI=1 and auto-NMI fallback on $4210 reads.
  process.env.SNES_RDNMI_INIT = process.env.SNES_RDNMI_INIT || '1';
  process.env.SNES_AUTOPULSE_NMI = process.env.SNES_AUTOPULSE_NMI || '1';
  process.env.SNES_AUTOPULSE_NMI_THRESHOLD = process.env.SNES_AUTOPULSE_NMI_THRESHOLD || '2';
  // Also enable auto HVBJOY bit7 toggling to break busy-wait loops on $4212 during CPU-only runs.
  process.env.SNES_AUTOPULSE_HVBJOY = process.env.SNES_AUTOPULSE_HVBJOY || '1';
  process.env.SNES_AUTOPULSE_HVBJOY_THRESHOLD = process.env.SNES_AUTOPULSE_HVBJOY_THRESHOLD || '64';
  // Turn on focused CPU debug and DP18 watch (unless quiet requested)
  if (process.env.CPU_DEBUG == null) process.env.CPU_DEBUG = quiet ? '0' : '1';
  if (process.env.DP18_WATCH == null) process.env.DP18_WATCH = quiet ? '0' : '1';

  const emu = Emulator.fromCartridge(cart);
  emu.reset();

  // Pre-align: advance our CPU up to a few steps until it matches the first trace PC, to ignore reset prologue differences.
  const first = trace[firstPcIdx] as Extract<typeof trace[number], { kind: 'pc' }>;
  for (let s = 0; s < 8; s++) {
    const pre0 = snapshot(emu.cpu as any);
    if (((pre0.PBR & 0xff) === first.PBR) && ((pre0.PC & 0xffff) === first.PC)) {
      break;
    }
    (emu as any).stepInstruction();
  }

  const hist: { step: number; PBR: number; PC: number; OP: number }[] = [];
  const pushHist = (s: { step: number; PBR: number; PC: number; OP: number }) => {
    hist.push(s);
    if (hist.length > 10) hist.shift();
  };

  for (let i = 0; i < trace.length; i++) {
    const exp = trace[i];
    if (exp.kind === 'loop') {
      // Step forward until we reach the next PC in the trace, within a budget.
      // Use the loop count as a hint for budget; allow a generous (configurable) multiplier.
      const nextPc = trace.slice(i + 1).find(t => t.kind === 'pc') as Extract<typeof trace[number], { kind: 'pc' }> | undefined;
      if (!nextPc) break; // nothing to align to; end
      const budget = Math.max(1, Math.min(loopHardMax, Math.floor(exp.count * loopMult)));
      let ok = false;
      for (let k = 0; k < budget; k++) {
        (emu as any).stepInstruction();
        const cur = snapshot(emu.cpu as any);
        // Inline probes during loop-elide stepping
        if ((cur.PBR & 0xff) === 0x00 && (cur.PC & 0xffff) >= 0xcc98 && (cur.PC & 0xffff) <= 0xccbe && !quiet) {
          const w7f002f = (emu.bus.read8(0x7f0000 | 0x002f) & 0xff);
          const dp12 = emu.bus.read8(0x000012) & 0xff;
          const dp14lo = emu.bus.read8(0x000014) & 0xff;
          const dp14hi = emu.bus.read8(0x000015) & 0xff;
          console.log(`[LOOP:CCBR] at ${hex(cur.PBR,2)}:${hex(cur.PC,4)} X=${hex(cur.X,4)} Y=${hex(cur.Y,4)} A=${hex(cur.A,4)} $7F:002F=${hex(w7f002f,2)} DP12=${hex(dp12,2)} DP14=${hex(((dp14hi<<8)|dp14lo)&0xffff,4)}`);
        }
        if (((cur.PBR & 0xff) === nextPc.PBR) && ((cur.PC & 0xffff) === nextPc.PC)) { ok = true; break; }
      }
      if (!ok) {
        // Fallback: skip ahead in the trace to our current PC if possible
        const cur = snapshot(emu.cpu as any);
        let skipTo = -1;
        for (let j = i + 1; j < trace.length && j <= i + exp.count + 256; j++) {
          const t = trace[j];
          if (t.kind !== 'pc') continue;
          if (((cur.PBR & 0xff) === t.PBR) && ((cur.PC & 0xffff) === t.PC)) { skipTo = j; break; }
        }
        if (skipTo >= 0) {
          if (!quiet) console.log(`[RESYNC] loop-elide skip -> aligned at ${hex(cur.PBR,2)}:${hex(cur.PC,4)} (trace step ${skipTo})`);
          i = skipTo;
          continue;
        }
        // As a last resort, try stepping up to the hard max budget before declaring divergence.
        const remaining = Math.max(0, loopHardMax - budget);
        if (remaining > 0) {
          for (let k = 0; k < remaining; k++) {
            (emu as any).stepInstruction();
            const cur2 = snapshot(emu.cpu as any);
            if (((cur2.PBR & 0xff) === nextPc.PBR) && ((cur2.PC & 0xffff) === nextPc.PC)) { ok = true; break; }
          }
        }
        if (!ok) {
          console.log('--- DIVERGENCE DETECTED (loop elision align failed) ---');
          console.log(`Wanted to align to ${hex(nextPc.PBR,2)}:${hex(nextPc.PC,4)} within ~${exp.count} steps (loopMult=${loopMult}, loopHardMax=${loopHardMax})`);
          console.log(`Actual   OUR: ${hex(cur.PBR,2)}:${hex(cur.PC,4)}`);
          process.exit(1);
        }
      }
      continue;
    }
    const pre = snapshot(emu.cpu as any);
    const addr24 = ((pre.PBR & 0xff) << 16) | (pre.PC & 0xffff);
    const op = emu.bus.read8(addr24) & 0xff;
    // Targeted: log JSL calls that target 00:816F or 00:8132 to see call-site PBR/PC
    if (op === 0x22) {
      const tLo = emu.bus.read8(((pre.PBR & 0xff) << 16) | ((pre.PC + 1) & 0xffff)) & 0xff;
      const tHi = emu.bus.read8(((pre.PBR & 0xff) << 16) | ((pre.PC + 2) & 0xffff)) & 0xff;
      const tBk = emu.bus.read8(((pre.PBR & 0xff) << 16) | ((pre.PC + 3) & 0xffff)) & 0xff;
      const tAddr = ((tHi << 8) | tLo) & 0xffff;
      if ((tBk === 0x00) && (tAddr === 0x816f || tAddr === 0x8132)) {
        if (!quiet) console.log(`[DBG:JSL-CALL] from ${hex(pre.PBR,2)}:${hex(pre.PC,4)} -> ${hex(tBk,2)}:${hex(tAddr,4)}`);
      }
    }
    if (op === 0x5c) {
      const tLo = emu.bus.read8(((pre.PBR & 0xff) << 16) | ((pre.PC + 1) & 0xffff)) & 0xff;
      const tHi = emu.bus.read8(((pre.PBR & 0xff) << 16) | ((pre.PC + 2) & 0xffff)) & 0xff;
      const tBk = emu.bus.read8(((pre.PBR & 0xff) << 16) | ((pre.PC + 3) & 0xffff)) & 0xff;
      const tAddr = ((tHi << 8) | tLo) & 0xffff;
      if (!quiet && (tAddr >= 0x8100 && tAddr <= 0x83ff)) {
        console.log(`[DBG:JML] from ${hex(pre.PBR,2)}:${hex(pre.PC,4)} -> ${hex(tBk,2)}:${hex(tAddr,4)}`);
      }
    }

    // Targeted debug probes to investigate divergence around $83E0..$83EA and subroutine $8266
    if ((pre.PBR & 0xff) === 0x00 && ((pre.PC & 0xffff) === 0x8266 || (pre.PC & 0xffff) === 0x826D || (pre.PC & 0xffff) === 0x8269 || (pre.PC & 0xffff) === 0x827F || (pre.PC & 0xffff) === 0x8286 || (pre.PC & 0xffff) === 0x828A || (pre.PC & 0xffff) === 0x83E2 || (pre.PC & 0xffff) === 0x83E4 || (pre.PC & 0xffff) === 0x837D || (pre.PC & 0xffff) === 0x8382 || (pre.PC & 0xffff) === 0x837F || (pre.PC & 0xffff) === 0x836E || (pre.PC & 0xffff) === 0x83C2 || (pre.PC & 0xffff) === 0x83C5 || (pre.PC & 0xffff) === 0x83CF || (pre.PC & 0xffff) === 0x83D1 || (pre.PC & 0xffff) === 0x828E || (pre.PC & 0xffff) === 0x8291 || (pre.PC & 0xffff) === 0x80F1 || (pre.PC & 0xffff) === 0x80F4 || (pre.PC & 0xffff) === 0x80F7 || (pre.PC & 0xffff) === 0x80F9 || (pre.PC & 0xffff) === 0x80FB || (pre.PC & 0xffff) === 0x81A5 || (pre.PC & 0xffff) === 0x8125 || (pre.PC & 0xffff) === 0x825B || (pre.PC & 0xffff) === 0x816F || (pre.PC & 0xffff) === 0x816E || (pre.PC & 0xffff) === 0x8192 || (pre.PC & 0xffff) === 0x8036 || (pre.PC & 0xffff) === 0x8193 || (pre.PC & 0xffff) === 0x825B || (pre.PC & 0xffff) === 0x8260 || (pre.PC & 0xffff) === 0x8196 || (pre.PC & 0xffff) === 0x8039)) {
      const mem18 = emu.bus.read8(0x000018) & 0xff;
      const mem19 = emu.bus.read8(0x000019) & 0xff;
      const mem12 = emu.bus.read8(0x000012) & 0xff;
      let extra = '';
      if ((pre.PC & 0xffff) === 0x836E) {
        // Decode ADC (dp,X) operand dp and compute pointer bytes/eff addr under our semantics
        const dp = emu.bus.read8(((pre.PBR & 0xff) << 16) | ((pre.PC + 1) & 0xffff)) & 0xff;
        const D = pre.D & 0xffff; const xLow = pre.X & 0xff;
        const prime = (dp + xLow) & 0xff;
        const loAddr = (D + prime) & 0xffff; const hiAddr = (D + ((prime + 1) & 0xff)) & 0xffff;
        const loB = emu.bus.read8(loAddr) & 0xff; const hiB = emu.bus.read8(hiAddr) & 0xff;
        const ptr = ((hiB << 8) | loB) & 0xffff; const dbr = pre.DBR & 0xff;
        const mlo = emu.bus.read8((dbr << 16) | ptr) & 0xff; const mhi = emu.bus.read8((dbr << 16) | ((ptr + 1) & 0xffff)) & 0xff;
        extra = ` dp=${hex(dp,2)} D=${hex(D,4)} xLow=${hex(xLow,2)} loAddr=${hex(loAddr,4)} hiAddr=${hex(hiAddr,4)} ptr=${hex(ptr,4)} DBR=${hex(dbr,2)} m=${hex((mhi<<8)|mlo,4)}`;
      }
      if ((pre.PC & 0xffff) === 0x80F1) {
        // STA dp at 00:80F1: print dp operand and value being stored
        const dp = emu.bus.read8(((pre.PBR & 0xff) << 16) | ((pre.PC + 1) & 0xffff)) & 0xff;
        const val = pre.A & 0xff;
        const eff = ((pre.E ? 0x0000 : (pre.D & 0xff00)) | dp) & 0xffff;
        extra += ` [STA dp dp=${hex(dp,2)} eff=${hex(eff,4)} val=${hex(val,2)}]`;
      }
      if ((pre.PC & 0xffff) === 0x80F7) {
        // LDA dp,X at 00:80F7: compute effective address with dp operand + X.low within DP page
        const dp = emu.bus.read8(((pre.PBR & 0xff) << 16) | ((pre.PC + 1) & 0xffff)) & 0xff;
        const D = pre.D & 0xffff; const xLow = pre.X & 0xff;
        const pageBase = pre.E ? 0x0000 : (D & 0xff00);
        const off = (dp + xLow) & 0xff;
        const eff = (pageBase | off) & 0xffff;
        const val = emu.bus.read8(eff) & 0xff;
        extra += ` [LDA dp,X dp=${hex(dp,2)} D=${hex(D,4)} xLow=${hex(xLow,2)} eff=${hex(eff,4)} val=${hex(val,2)}]`;
      }
      // Probe calls to wait-vblank routine at 00:825B from two callers (00:8036 and 00:8193)
      if ((pre.PC & 0xffff) === 0x8036 && op === 0x20) {
        if (!quiet) console.log(`[DBG:CALL] 00:8036 -> 00:825B`);
      }
      if ((pre.PC & 0xffff) === 0x8193 && op === 0x20) {
        if (!quiet) console.log(`[DBG:CALL] 00:8193 -> 00:825B`);
      }
      // Probe inside wait-vblank subroutine BIT $4210 loops
      if ((pre.PC & 0xffff) === 0x825b || (pre.PC & 0xffff) === 0x8260) {
        const rdnmi = emu.bus.read8(0x004210) & 0xff;
        const nFlag = (pre.P & 0x80) !== 0 ? 1 : 0;
        extra += ` [RDNMI=${hex(rdnmi,2)} N=${nFlag}]`;
      }
      // Extra probe for the DP12/A path around 00:8269/00:827F and the call site LDA long at 00:8286/00:828A
      if ((pre.PC & 0xffff) === 0x8269 || (pre.PC & 0xffff) === 0x827f || (pre.PC & 0xffff) === 0x8286 || (pre.PC & 0xffff) === 0x828a) {
        if (!quiet) console.log(`[DBG:A-PROBE] at ${hex(pre.PBR,2)}:${hex(pre.PC,4)} OP=${hex(op,2)} A=${hex(pre.A,4)} P=${hex(pre.P,2)} X=${hex(pre.X,4)} Y=${hex(pre.Y,4)} mem[12:13]=${hex(mem12,2)} ${hex(emu.bus.read8(0x000013)&0xff,2)} DP18=${hex(mem18,2)} DP19=${hex(mem19,2)}`);
      }
      // If about to RTS at 00:8293, peek return address
      if ((pre.PBR & 0xff) === 0x00 && (pre.PC & 0xffff) === 0x8293 && op === 0x60) {
        const s = pre.S & 0xffff;
        const lo = emu.bus.read8(0x000100 | ((s + 1) & 0xff)) & 0xff;
        const hi = emu.bus.read8(0x000100 | ((s + 2) & 0xff)) & 0xff;
        const addr = ((hi << 8) | lo) & 0xffff;
        if (!quiet) console.log(`[DBG:RTS-8293] ret=${hex(addr,4)} next=${hex((addr+1)&0xffff,4)}`);
      }
      // If about to RTL (00:8192 or 00:816E), peek top-of-stack to see the pending return address/bank
      if ((pre.PC & 0xffff) === 0x8192 || (pre.PC & 0xffff) === 0x816E || (pre.PC & 0xffff) === 0x8196 || (pre.PC & 0xffff) === 0x8039) {
        const s = pre.S & 0xffff;
        const stkLo = emu.bus.read8(0x000100 | ((s + 1) & 0xff)) & 0xff;
        const stkHi = emu.bus.read8(0x000100 | ((s + 2) & 0xff)) & 0xff;
        const stkB  = emu.bus.read8(0x000100 | ((s + 3) & 0xff)) & 0xff;
        extra += ` [STK top -> bank=${hex(stkB,2)} addr=${hex(((stkHi<<8)|stkLo)&0xffff,4)}]`;
        try {
          const ring: any[] = (globalThis as any).__lastIR || [];
          for (let i = ring.length - 1; i >= 0; i--) {
            const it = ring[i];
            if (((it?.OP ?? 0) & 0xff) === 0x22) {
              extra += ` [CALLSITE ${hex((it?.PBR ?? 0)&0xff,2)}:${hex((it?.PC ?? 0)&0xffff,4)}]`;
              break;
            }
          }
        } catch { /* noop */ }
        // Emit a small tail of stack operations if available
        try {
          const st: any[] = (globalThis as any).__stackLog || [];
          const tail = st.slice(Math.max(0, st.length - 6));
          extra += ` [STKOPS ${tail.map(e => (e?.evt||e?.kind||'').toString()).join(',')}]`;
        } catch { /* noop */ }
      }
      if (!quiet) console.log(`[DBG] at ${hex(pre.PBR,2)}:${hex(pre.PC,4)} OP=${hex(op,2)} P=${hex(pre.P,2)} E=${pre.E ? 1 : 0} A=${hex(pre.A,4)} X=${hex(pre.X,4)} Y=${hex(pre.Y,4)} mem[12]=${hex(mem12,2)} mem[18:19]=${hex(mem18,2)} ${hex(mem19,2)}${extra}`);
    }

    // Broad probe across 00:8300..00:8385 to catch P transitions
    if ((pre.PBR & 0xff) === 0x00 && (pre.PC & 0xffff) >= 0x8300 && (pre.PC & 0xffff) <= 0x8385) {
      if (!quiet) console.log(`[DBG:RANGE] at ${hex(pre.PBR,2)}:${hex(pre.PC,4)} OP=${hex(op,2)} P=${hex(pre.P,2)} E=${pre.E?1:0}`);
    }
    // Probe branch chain around 00:CC98..00:CCBE (decides on JML $01802E)
    if ((pre.PBR & 0xff) === 0x00 && (pre.PC & 0xffff) >= 0xcc98 && (pre.PC & 0xffff) <= 0xccbe) {
      const w7f002f = (emu.bus.read8(0x7f0000 | 0x002f) & 0xff);
      const dp12 = emu.bus.read8(0x000012) & 0xff;
      const dp14lo = emu.bus.read8(0x000014) & 0xff;
      const dp14hi = emu.bus.read8(0x000015) & 0xff;
      if (!quiet) console.log(`[DBG:CCBR] at ${hex(pre.PBR,2)}:${hex(pre.PC,4)} X=${hex(pre.X,4)} Y=${hex(pre.Y,4)} A=${hex(pre.A,4)} $7F:002F=${hex(w7f002f,2)} DP12=${hex(dp12,2)} DP14=${hex(((dp14hi<<8)|dp14lo)&0xffff,4)}`);
    }

    // Compare PC/PBR/opcode to MAME
    let match = (pre.PBR & 0xff) === (exp as any).PBR && (pre.PC & 0xffff) === (exp as any).PC;

    // Auto-handle common reset alignment off-by-one: our PC may start at vector target, MAME may print after XCE
    if (!match && i === 0 && (pre.PBR & 0xff) === exp.PBR && (((pre.PC + 1) & 0xffff) === exp.PC)) {
      // Step once to align and retry this same trace entry
      pushHist({ step: -1, PBR: pre.PBR & 0xff, PC: pre.PC & 0xffff, OP: op & 0xff });
      (emu as any).stepInstruction();
      // re-evaluate after stepping
      const pre2 = snapshot(emu.cpu as any);
      const addr242 = ((pre2.PBR & 0xff) << 16) | (pre2.PC & 0xffff);
      const op2 = emu.bus.read8(addr242) & 0xff;
      match = (pre2.PBR & 0xff) === exp.PBR && (pre2.PC & 0xffff) === exp.PC;
      if (!match) {
        console.log('--- DIVERGENCE DETECTED (after auto-align) ---');
        console.log(`Step #${i}`);
        console.log(`Expected MAME: ${hex((exp as any).PBR,2)}:${hex((exp as any).PC,4)} | Line: ${(exp as any).raw}`);
        console.log(`Actual   OUR: ${hex(pre2.PBR,2)}:${hex(pre2.PC,4)} OP=${hex(op2,2)}`);
        console.log(`Regs: A=${hex(pre2.A,4)} X=${hex(pre2.X,4)} Y=${hex(pre2.Y,4)} S=${hex(pre2.S,4)} D=${hex(pre2.D,4)} DBR=${hex(pre2.DBR,2)} P=${hex(pre2.P,2)} E=${pre2.E ? 1 : 0}`);
        console.log('Recent history (last up to 10 steps inc. pre-align):');
        for (const h of hist) console.log(`  ${hex(h.PBR,2)}:${hex(h.PC,4)} OP=${hex(h.OP,2)} (step ${h.step})`);
        process.exit(1);
      }
      // proceed using the aligned snapshot as current step
      continue; // retry loop iteration i with new CPU state already advanced
    }

    if (!match) {
      // Try resync by skipping ahead in the trace if our PC already matches a future PC.
      const aheadWin = Math.max(1, resyncWin);
      let skipIdx = -1;
      for (let j = i + 1, seen = 0; j < trace.length && seen < aheadWin; j++) {
        const t = trace[j];
        if (t.kind !== 'pc') continue;
        seen++;
        if (((pre.PBR & 0xff) === t.PBR) && ((pre.PC & 0xffff) === t.PC)) { skipIdx = j; break; }
      }
      if (skipIdx >= 0) {
        if (!quiet) console.log(`[RESYNC] skipping ahead ${skipIdx - i} trace items; aligned at ${hex(pre.PBR,2)}:${hex(pre.PC,4)} (trace step ${skipIdx})`);
        i = skipIdx; // jump trace index to the matching PC
        continue;
      }

      // Attempt forward resync by stepping our emulator up to resyncWin instructions
      if (resyncWin > 0) {
        const savedHist = [...hist];
        const preA = pre; const preOp = op;
        let synced = false; let k = 0;
        for (k = 1; k <= resyncWin; k++) {
          (emu as any).stepInstruction();
          const now = snapshot(emu.cpu as any);
          const addr = ((now.PBR & 0xff) << 16) | (now.PC & 0xffff);
          const opNow = emu.bus.read8(addr) & 0xff;
          // Inline probes during resync stepping
          if ((now.PBR & 0xff) === 0x00 && (now.PC & 0xffff) >= 0xcc98 && (now.PC & 0xffff) <= 0xccbe && !quiet) {
            const w7f002f = (emu.bus.read8(0x7f0000 | 0x002f) & 0xff);
            const dp12 = emu.bus.read8(0x000012) & 0xff;
            const dp14lo = emu.bus.read8(0x000014) & 0xff;
            const dp14hi = emu.bus.read8(0x000015) & 0xff;
            console.log(`[RS:CCBR] at ${hex(now.PBR,2)}:${hex(now.PC,4)} X=${hex(now.X,4)} Y=${hex(now.Y,4)} A=${hex(now.A,4)} $7F:002F=${hex(w7f002f,2)} DP12=${hex(dp12,2)} DP14=${hex(((dp14hi<<8)|dp14lo)&0xffff,4)}`);
          }
          pushHist({ step: i + k, PBR: now.PBR & 0xff, PC: now.PC & 0xffff, OP: opNow & 0xff });
          if (((now.PBR & 0xff) === (exp as any).PBR) && ((now.PC & 0xffff) === (exp as any).PC)) { synced = true; break; }
        }
        if (synced) {
          if (!quiet) console.log(`[RESYNC] drifted ${k} insns; aligned at ${hex((exp as any).PBR,2)}:${hex((exp as any).PC,4)} (trace step ${i})`);
          continue; // proceed with this same trace entry aligned
        } else {
          console.log('--- DIVERGENCE DETECTED ---');
          console.log(`Step #${i}`);
          console.log(`Expected MAME: ${hex((exp as any).PBR,2)}:${hex((exp as any).PC,4)} | Line: ${(exp as any).raw}`);
          console.log(`Actual   OUR: ${hex(pre.PBR,2)}:${hex(pre.PC,4)} OP=${hex(preOp,2)}`);
          console.log(`Regs: A=${hex(pre.A,4)} X=${hex(pre.X,4)} Y=${hex(pre.Y,4)} S=${hex(pre.S,4)} D=${hex(pre.D,4)} DBR=${hex(pre.DBR,2)} P=${hex(pre.P,2)} E=${pre.E ? 1 : 0}`);
          console.log('Recent history (last up to 10 steps before divergence):');
          for (const h of savedHist) console.log(`  ${hex(h.PBR,2)}:${hex(h.PC,4)} OP=${hex(h.OP,2)} (step ${h.step})`);
          // Dump recent stack ops and call stack if available
          try {
            const g: any = globalThis as any;
            const st: any[] = Array.isArray(g.__stackLog) ? g.__stackLog : [];
            const frames: any[] = Array.isArray(g.__callFrames) ? g.__callFrames : [];
            const start = Math.max(0, st.length - 16);
            console.log('Recent stack ops (last up to 16):');
            for (let ii = start; ii < st.length; ii++) {
              const e = st[ii];
              console.log(`  [${ii}] ${JSON.stringify(e)}`);
            }
            console.log('Current call stack (top last):');
            for (let ii = Math.max(0, frames.length - 8); ii < frames.length; ii++) {
              const f = frames[ii];
              console.log(`  ${ii}: ${hex(f.fromPBR||0,2)}:${hex(f.fromPC||0,4)} -> ${hex(f.toPBR||0,2)}:${hex(f.toPC||0,4)} type=${f.type} S=${hex(f.sAtCall||0,4)}`);
            }
          } catch { /* noop */ }
          process.exit(1);
        }
      } else {
        console.log('--- DIVERGENCE DETECTED ---');
        console.log(`Step #${i}`);
        console.log(`Expected MAME: ${hex((exp as any).PBR,2)}:${hex((exp as any).PC,4)} | Line: ${(exp as any).raw}`);
        console.log(`Actual   OUR: ${hex(pre.PBR,2)}:${hex(pre.PC,4)} OP=${hex(op,2)}`);
        console.log(`Regs: A=${hex(pre.A,4)} X=${hex(pre.X,4)} Y=${hex(pre.Y,4)} S=${hex(pre.S,4)} D=${hex(pre.D,4)} DBR=${hex(pre.DBR,2)} P=${hex(pre.P,2)} E=${pre.E ? 1 : 0}`);
        console.log('Recent history (last up to 10 steps before divergence):');
        for (const h of hist) {
          console.log(`  ${hex(h.PBR,2)}:${hex(h.PC,4)} OP=${hex(h.OP,2)} (step ${h.step})`);
        }
        process.exit(1);
      }
    }

    pushHist({ step: i, PBR: pre.PBR & 0xff, PC: pre.PC & 0xffff, OP: op & 0xff });
    // Execute one instruction
    emu.stepInstruction();
  }

  console.log(`OK: Compared ${Math.min(trace.length, maxSteps)} steps; no divergence found.`);
}

main();

