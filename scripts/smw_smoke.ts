import path from 'path';

async function main() {
  const cwd = process.cwd();
  const rom = process.env.SMW_ROM || path.resolve(cwd, 'smw.sfc');
  const frames = Number(process.env.SMW_SMOKE_FRAMES ?? '1200') | 0;
  const out = process.env.SMW_SMOKE_OUT || 'smw_smoke.png';
  const start = Number(process.env.SMW_SMOKE_START_FRAME ?? '600') | 0;
  const ips = Number(process.env.SMW_IPS ?? '200') | 0;
  const traceCpu = Number(process.env.SMW_TRACE_CPU ?? '0') | 0;
  const logLimit = process.env.SMW_LOG_LIMIT ?? '300';
  const logFilter = process.env.SMW_LOG_FILTER; // optional CSV like 0x2100,0x4210

  // Default-enable APU shim but restrict to handshake only for accuracy (no tile/unblank injection)
  if (process.env.SMW_APU_SHIM === undefined) process.env.SMW_APU_SHIM = '1';
  process.env.SMW_APU_SHIM_ONLY_HANDSHAKE = process.env.SMW_APU_SHIM_ONLY_HANDSHAKE ?? '1';
  process.env.SMW_APU_SHIM_TILE = process.env.SMW_APU_SHIM_TILE ?? '0';
  process.env.SMW_APU_SHIM_UNBLANK = process.env.SMW_APU_SHIM_UNBLANK ?? '0';

  // Build argument vector for headless_screenshot
  const args: string[] = [];
  args.push(`--rom=${rom}`);
  args.push(`--frames=${frames}`);
  args.push(`--out=${out}`);
  args.push(`--ips=${ips}`);
  args.push(`--pressStartFrame=${start}`);
  args.push(`--noFallback=1`);
  args.push(`--debug=1`);
  args.push(`--logMmio=1`);
  args.push(`--traceCpu=${traceCpu}`);
  if (logLimit) args.push(`--logMmioLimit=${logLimit}`);
  if (logFilter) args.push(`--logMmioFilter=${logFilter}`);

  // Run the headless screenshot tool with our arguments
  const oldArgv = [...process.argv];
  try {
    process.argv = [oldArgv[0], 'scripts/smw_smoke.ts', ...args];
    const mod = await import('./headless_screenshot.ts');
    // Ensure the module was loaded successfully
    if (!mod) {
      throw new Error('Failed to load headless_screenshot module');
    }
  } finally {
    process.argv = oldArgv;
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[smw_smoke] error:', e);
  process.exit(1);
});

