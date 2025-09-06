#!/usr/bin/env tsx
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function arg(name: string, def?: string): string | undefined {
  const pref = `--${name}=`;
  for (const a of process.argv.slice(2)) if (a.startsWith(pref)) return a.slice(pref.length);
  return def;
}

const rom = arg('rom');
const secsArg = arg('secs');
const frames = secsArg ? String(Math.max(1, Math.round(Number(secsArg) * 60))) : (arg('frames', '1800')!);
const out = arg('out', 'artifacts/trace/trace_snes.log')!;
const pidFileArg = arg('pidFile');

if (!rom) {
  console.error('Usage: tsx scripts/trace_snes_mame.ts --rom=path/to.rom [--secs=3|--frames=1800] [--out=artifacts/trace/trace_snes.log] [--pidFile=artifacts/pids/mame.pid]');
  process.exit(2);
}

const romPath = path.resolve(rom);
const outPath = path.resolve(out);
const outDir = path.dirname(outPath);
try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
// Prepare a temporary debugger script to start tracing and run
const dbgDir = path.resolve('artifacts/mame/tmp');
try { fs.mkdirSync(dbgDir, { recursive: true }); } catch {}
const dbgPath = path.join(dbgDir, 'trace.dbg');
// Create a debugger script: focus CPU then start tracing to the path (no quotes)
const dbg = `focus :maincpu\ntrace ${outPath}\ngo\n`;
fs.writeFileSync(dbgPath, dbg, 'utf8');

const env = { ...process.env } as NodeJS.ProcessEnv;
const args = [
  'snes',
  '-cart', romPath,
  '-rompath', path.resolve('artifacts/mame/roms'),
  '-noreadconfig',
  '-nothrottle',
  '-nowaitvsync',
  '-video', 'none',
  '-sound', 'none',
  '-debug',
  '-debugscript', dbgPath,
];
const secs = secsArg ? Number(secsArg) : 0;
if (secs > 0) {
  args.push('-seconds_to_run', String(secs));
}

// Ensure we have a pids directory and decide where to store the child PID
const pidsDir = path.resolve('artifacts/pids');
try { fs.mkdirSync(pidsDir, { recursive: true }); } catch {}
const pidFile = path.resolve(pidFileArg || path.join(pidsDir, `mame-${Date.now()}.pid`));

// Detach so the child becomes its own process group; this lets us kill the whole tree via -PID
const proc = spawn('mame', args, { env, stdio: 'inherit', detached: true });

// Persist PID for external tooling/cleanup
try { fs.writeFileSync(pidFile, String(proc.pid)); } catch {}

function killProcessTree(signal: NodeJS.Signals = 'SIGINT') {
  // Kill the process group (-pid) first; fall back to the child PID if needed
  try { process.kill(-(proc.pid as number), signal); } catch {
    try { proc.kill(signal); } catch {}
  }
}

// Hard timeout: kill MAME after the requested seconds (+0.5s buffer)
const killAfterMs = (secs > 0 ? secs : Number(frames) / 60) * 1000 + 500;
const timer = setTimeout(() => {
  if (!proc.killed) {
    killProcessTree('SIGINT');
    // Fallback: force kill after another 0.5s
    setTimeout(() => { killProcessTree('SIGKILL'); }, 500);
  }
}, Math.max(1000, killAfterMs));

proc.on('exit', (code) => {
  clearTimeout(timer);
  try { fs.unlinkSync(pidFile); } catch {}
  process.exit(code ?? 0);
});

