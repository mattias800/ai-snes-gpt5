import fs from 'fs';
import { PNG } from 'pngjs';
import { normaliseRom } from '../src/cart/loader.ts';
import { parseHeader } from '../src/cart/header.ts';
import { Cartridge } from '../src/cart/cartridge.ts';
import { Emulator } from '../src/emulator/core.ts';
import { Scheduler } from '../src/emulator/scheduler.ts';
import { renderMainScreenRGBA } from '../src/ppu/bg.ts';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function countNonZeroWords(u16: Uint16Array): number {
  let c = 0;
  for (let i = 0; i < u16.length; i++) if (u16[i] !== 0) c++;
  return c;
}

async function main() {
  const args = parseArgs(process.argv);
  const romPath = args.rom || process.env.SMW_ROM;
  const outPath = args.out || 'screenshot.png';
  const frames = Number.isFinite(Number(args.frames)) ? Math.max(1, Number(args.frames)) : (Number(process.env.SMW_FRAMES) || 180);
  const ips = Number.isFinite(Number(args.ips)) ? Math.max(1, Number(args.ips)) : (Number(process.env.SMW_IPS) || 200);
  const width = Number.isFinite(Number(args.width)) ? Number(args.width) : 256;
  const height = Number.isFinite(Number(args.height)) ? Number(args.height) : 224;
  const holdStart = (args.holdStart ?? '1') !== '0';
  const pressStartFrame = Number.isFinite(Number(args.pressStartFrame)) ? Math.max(-1, Number(args.pressStartFrame)) : (Number(process.env.SMW_PRESS_START_FRAME ?? '-1'));
  const cpuErrMode = (args.onCpuError as 'ignore'|'throw'|'record') || (process.env.SMW_CPUERR as any) || 'record';
  const debug = (args.debug ?? process.env.SMW_DEBUG ?? '0') !== '0';
  const forceUnblank = (args.forceUnblank ?? process.env.SMW_FORCE_UNBLANK ?? '0') !== '0';
  const forceEnableBG1 = (args.forceEnableBG1 ?? process.env.SMW_FORCE_BG1 ?? '0') !== '0';
  let autoFallback = (args.autoFallback ?? process.env.SMW_AUTO_FALLBACK ?? '1') !== '0';
  const noFallbackArg = (args.noFallback ?? args['no-fallback']);
  if (typeof noFallbackArg !== 'undefined') {
    const nf = (noFallbackArg === '1' || noFallbackArg === 'true');
    if (nf) autoFallback = false;
  }
  const logMmio = (args.logMmio ?? process.env.SMW_LOG_MMIO ?? '0') !== '0';
  const logMmioLimit = args.logMmioLimit ?? process.env.SMW_LOG_LIMIT;
  const logMmioFilter = args.logMmioFilter ?? process.env.SMW_LOG_FILTER;
  const traceCpuEvery = Number.isFinite(Number(args.traceCpu)) ? Math.max(0, Number(args.traceCpu)) : (Number(process.env.SMW_TRACE_CPU ?? '0'));

  if (!romPath) {
    console.error('Usage: npm run screenshot -- --rom=path/to/SMW.sfc --out=./out.png [--frames=180] [--ips=200] [--width=256] [--height=224] [--holdStart=1] [--onCpuError=record|throw|ignore] [--debug=0|1] [--forceUnblank=0|1] [--forceEnableBG1=0|1]');
    process.exit(1);
  }

  console.log(`[screenshot] ROM: ${romPath}  out: ${outPath}  frames: ${frames}  ips: ${ips}  size: ${width}x${height}  holdStart=${holdStart}  pressStartFrame=${pressStartFrame}  onCpuError=${cpuErrMode}  debug=${debug}  forceUnblank=${forceUnblank}  forceEnableBG1=${forceEnableBG1}  autoFallback=${autoFallback}  logMmio=${logMmio}  traceCpu=${traceCpuEvery}`);

  // Configure optional MMIO logging via env so the bus can pick it up in constructor
  if (logMmio) process.env.SMW_LOG_MMIO = '1';
  if (typeof logMmioLimit !== 'undefined') process.env.SMW_LOG_LIMIT = String(logMmioLimit);
  if (typeof logMmioFilter !== 'undefined') process.env.SMW_LOG_FILTER = String(logMmioFilter);

  const raw = fs.readFileSync(romPath);
  const { rom } = normaliseRom(new Uint8Array(raw));
  const header = parseHeader(rom);
  console.log(`[screenshot] Detected mapping=${header.mapping} title="${header.title}" checksum=${header.checksum.toString(16)}`);
  const cart = new Cartridge({ rom, mapping: header.mapping });
  const emu = Emulator.fromCartridge(cart);
  emu.reset();

  const sched = new Scheduler(emu, ips, { onCpuError: cpuErrMode, traceEveryInstr: traceCpuEvery });
  if (holdStart) emu.bus.setController1State({ Start: true });

  try {
    for (let i = 0; i < frames; i++) {
      // Simulate momentary Start press at a chosen frame
      if (pressStartFrame >= 0) {
        if (i === pressStartFrame) emu.bus.setController1State({ Start: true });
        if (i === pressStartFrame + 1) emu.bus.setController1State({ Start: false });
      }
      sched.stepFrame();
      if (i % 30 === 29) console.log(`[screenshot] stepped ${i + 1} frames`);
    }
  } catch (e) {
    console.error('[screenshot] CPU error during stepping:', e);
    if (cpuErrMode === 'throw') throw e;
    // else continue to attempt rendering with current state
  }

  const ppu = emu.bus.getPPU() as any;

  let vCount = -1;
  let cCount = -1;
  if (debug) {
    // Access private arrays via reflection for diagnostics only
    const vram: Uint16Array | undefined = (ppu as any).vram;
    const cgram: Uint8Array | undefined = (ppu as any).cgram;
    vCount = vram ? countNonZeroWords(vram) : -1;
    const cPairs = cgram ? new Uint16Array(cgram.buffer, cgram.byteOffset, Math.floor(cgram.byteLength / 2)) : undefined;
    cCount = cPairs ? countNonZeroWords(cPairs) : -1;
    console.log(`[screenshot][debug] PPU: forceBlank=${ppu.forceBlank} brightness=${ppu.brightness} tm=0x${(ppu.tm ?? 0).toString(16)} ts=0x${(ppu.ts ?? 0).toString(16)} cgadsub=0x${(ppu.cgadsub ?? 0).toString(16)} cgwsel=0x${(ppu.cgwsel ?? 0).toString(16)} vramNonZeroWords=${vCount} cgramNonZeroWords=${cCount}`);
    // Optional tilemap dump around 0x0021 (where the ROM writes header text)
    try {
      const base = 0x0020;
      const words: number[] = [];
      for (let i = 0; i < 16; i++) {
        const w = ppu.inspectVRAMWord((base + i) & 0x7fff) & 0xffff;
        words.push(w);
      }
      console.log(`[screenshot][debug] VRAM[0x${base.toString(16)}..] = ${words.map(w=>`0x${w.toString(16).padStart(4,'0')}`).join(' ')}`);
      console.log(`[screenshot][debug] BG1 mapBaseWord=0x${(ppu.bg1MapBaseWord||0).toString(16)} charBaseWord=0x${(ppu.bg1CharBaseWord||0).toString(16)} bgMode=${ppu.bgMode}`);
    } catch {}
  }

  if (forceUnblank) {
    ppu.forceBlank = false;
    ppu.brightness = 0x0f;
  }
  if (forceEnableBG1) {
    ppu.tm = (ppu.tm | 0x01) & 0x1f;
  }

  // Fallback: if APU boot prevented the game from drawing anything (blank + zero VRAM/CGRAM), draw a simple test tile
  if (autoFallback && (ppu.forceBlank || (vCount === 0 && cCount === 0))) {
    console.log('[screenshot][fallback] Injecting minimal BG1 tile and palette to avoid black frame');
    const bus = (emu as any).bus as { write8: (addr: number, v: number) => void };
    const mmio = (reg: number) => (0x00 << 16) | (0x2100 + (reg & 0xff));
    const w8 = (addr: number, v: number) => bus.write8(addr, v & 0xff);

    // Unblank and full brightness
    w8(mmio(0x00), 0x0f);
    // Enable BG1 on main screen
    w8(mmio(0x2c), 0x01);
    // BG1 tilemap base 0x0000, 32x32
    w8(mmio(0x07), 0x00);
    // BG1 char base 0x0000
    w8(mmio(0x0b), 0x00);
    // Set VRAM increment after high, step +1 word
    w8(mmio(0x15), 0x00);

    // Write 4bpp tile 0: make plane0=1 across rows -> palette index 1 solid
    // Tile 0 data at char base 0x0000, 16 words (32 bytes)
    w8(mmio(0x16), 0x00); w8(mmio(0x17), 0x00); // VMADDL/H = 0x0000
    for (let y = 0; y < 8; y++) {
      // low planes bytes for row y: plane0=0xFF, plane1=0x00
      w8(mmio(0x18), 0xff); w8(mmio(0x19), 0x00);
    }
    for (let y = 0; y < 8; y++) {
      // high planes bytes (plane2,3) zero
      w8(mmio(0x18), 0x00); w8(mmio(0x19), 0x00);
    }
    // Write tilemap entry (0,0) to tile 0
    w8(mmio(0x16), 0x00); w8(mmio(0x17), 0x00); // VRAM addr 0x0000 for map
    w8(mmio(0x18), 0x00); w8(mmio(0x19), 0x00);

    // Set CGRAM palette index 1 = red max (BGR555: R=31)
    w8(mmio(0x21), 2); // CGADD index 1
    const red = (31 << 10) & 0x7fff;
    w8(mmio(0x22), red & 0xff);
    w8(mmio(0x22), (red >> 8) & 0xff);

    // Update local flags since we wrote via MMIO
    ppu.forceBlank = false;
    ppu.brightness = 0x0f;
    ppu.tm = (ppu.tm | 0x01) & 0x1f;
  }

  const rgba = renderMainScreenRGBA(emu.bus.getPPU(), width, height);

  const png = new PNG({ width, height });
  // pngjs expects a Buffer; ensure we pass a Node Buffer view
  const buf = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  buf.copy(png.data);

  await new Promise<void>((resolve, reject) => {
    const s = fs.createWriteStream(outPath);
    png.pack().pipe(s);
    s.on('finish', () => resolve());
    s.on('error', (e) => reject(e));
  });

  // Basic sanity metrics
  if (debug) {
    let sum = 0;
    for (let i = 0; i < rgba.length; i += 4) sum += rgba[i] + rgba[i + 1] + rgba[i + 2];
    console.log(`[screenshot][debug] totalRGBSum=${sum}`);
  }

  console.log(`Wrote ${outPath} (${width}x${height}) after ${frames} frames at ${ips} ips`);
}

main().catch((e) => {
  console.error('[screenshot] Unhandled error:', e);
  process.exit(1);
});

