import { Emulator } from "../src/emulator/core";
import { Scheduler } from "../src/emulator/scheduler";
import { renderMainScreenRGBA } from "../src/ppu/bg";
import { normaliseRom } from "../src/cart/loader";
import { parseHeader } from "../src/cart/header";
import { Cartridge } from "../src/cart/cartridge";
import type { Button } from "../src/input/controller";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;

const romFile = $("#romFile") as HTMLInputElement;
const ipsInput = $("#ips") as HTMLInputElement;
const scaleInput = $("#scale") as HTMLInputElement;
const shimChk = $("#shim") as HTMLInputElement;
const shimOnlyChk = $("#shimOnly") as HTMLInputElement;
const shimTileChk = $("#shimTile") as HTMLInputElement;
const statusEl = $("#status");
const logEl = $("#log");
const resetBtn = $("#resetBtn");
const pauseBtn = $("#pauseBtn");
const canvas = $("#screen") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { alpha: false })!;

let emu: Emulator | null = null;
let sched: Scheduler | null = null;
let rafId = 0;
let running = false;

// Keyboard -> controller state
const keyToBtn: Record<string, Button> = {
  // D-pad
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  // Face buttons (common layout)
  KeyZ: "B",
  KeyX: "A",
  KeyA: "Y",
  KeyS: "X",
  // Shoulder
  KeyQ: "L",
  KeyW: "R",
  // Start/Select
  Enter: "Start",
  ShiftLeft: "Select",
  ShiftRight: "Select",
};
const held = new Map<Button, boolean>();

function setEnvForShim() {
  const env: Record<string, string> = {};
  if (shimChk.checked) env.SMW_APU_SHIM = "1"; else env.SMW_APU_SHIM = "0";
  // Handshake only determines if shim writes PPU
  env.SMW_APU_SHIM_ONLY_HANDSHAKE = shimOnlyChk.checked ? "1" : "0";
  // If ONLY_HANDSHAKE=1, force UNBLANK/TILE=0 to avoid conflicting writes
  env.SMW_APU_SHIM_UNBLANK = (!shimOnlyChk.checked && shimChk.checked) ? "1" : "0";
  env.SMW_APU_SHIM_TILE = (shimTileChk.checked && shimChk.checked && !shimOnlyChk.checked) ? "1" : "0";
  // Expose to code paths that read process.env
  (globalThis as any).process = { env };
}

function setCanvasScale() {
  const scale = Math.max(1, Math.min(6, Number(scaleInput.value) || 3));
  canvas.style.width = `${256 * scale}px`;
  canvas.style.height = `${224 * scale}px`;
}

function attachKeyboard() {
  window.addEventListener("keydown", (e) => {
    const btn = keyToBtn[e.code];
    if (btn) {
      held.set(btn, true);
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    const btn = keyToBtn[e.code];
    if (btn) {
      held.set(btn, false);
      e.preventDefault();
    }
  });
}

function applyControllerState() {
  if (!emu) return;
  const busAny = (emu.bus as any);
  if (typeof busAny.setController1State === "function") {
    const state: Partial<Record<Button, boolean>> = {};
    for (const [b, v] of held.entries()) state[b] = !!v;
    busAny.setController1State(state);
  }
}

function log(msg: string) {
  logEl.textContent = msg;
}

function setStatus(text: string) {
  statusEl.textContent = text;
}

function stopLoop() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function frame() {
  if (!emu || !sched) return;
  // Per-frame input latch
  applyControllerState();
  // Step one frame of emulation
  const ips = Math.max(50, Math.min(5000, Number(ipsInput.value) || 800));
  (sched as any).instrPerScanline = ips; // internal, but fine for our harness
  try {
    sched.stepFrame();
  } catch (e) {
    console.error(e);
    setStatus("CPU exception (see console)");
    stopLoop();
    return;
  }
  // Render PPU output to canvas
  const ppu = emu.bus.getPPU();
  const rgba = renderMainScreenRGBA(ppu, 256, 224);
  const img = new ImageData(rgba, 256, 224);
  ctx.putImageData(img, 0, 0);

  if (running) rafId = requestAnimationFrame(frame);
}

async function bootFromRomBytes(bytes: Uint8Array) {
  stopLoop();
  setStatus("Booting ROM...");
  setEnvForShim();

  // Normalise and parse header
  const { rom } = normaliseRom(bytes);
  const header = parseHeader(rom);
  const cart = new Cartridge({ rom, mapping: header.mapping });
  const _emu = Emulator.fromCartridge(cart);
  _emu.reset();

  const ips = Math.max(50, Math.min(5000, Number(ipsInput.value) || 800));
  const _sched = new Scheduler(_emu, ips, { onCpuError: "throw" });

  emu = _emu; sched = _sched;

  // Start loop
  running = true;
  setCanvasScale();
  setStatus(`Loaded: ${header.title || "(unknown)"} [${header.mapping}]`);
  rafId = requestAnimationFrame(frame);
  resetBtn.toggleAttribute("disabled", false);
  pauseBtn.toggleAttribute("disabled", false);
}

async function loadFile(f: File) {
  const ab = new Uint8Array(await f.arrayBuffer());
  await bootFromRomBytes(ab);
}

romFile.addEventListener("change", () => {
  const f = romFile.files?.[0];
  if (f) {
    void loadFile(f);
  }
});

resetBtn.addEventListener("click", () => {
  if (!emu) return;
  emu.reset();
  setStatus("Reset");
});

pauseBtn.addEventListener("click", () => {
  if (!emu) return;
  if (running) { stopLoop(); pauseBtn.textContent = "Resume"; }
  else { running = true; pauseBtn.textContent = "Pause"; rafId = requestAnimationFrame(frame); }
});

scaleInput.addEventListener("change", setCanvasScale);
[shimChk, shimOnlyChk, shimTileChk].forEach((el) => el.addEventListener("change", () => {
  // Re-apply env flags next boot. No hot reload for now.
  setEnvForShim();
}));

attachKeyboard();
setCanvasScale();
log(
  [
    "Controls:",
    "  Arrows = D-Pad",
    "  Z/X = B/A, A/S = Y/X, Q/W = L/R, Enter = Start, Shift = Select",
    "",
    "Load an SMW ROM (.sfc/.smc). Use the Shim options if you want to bypass APU init.",
  ].join("\n")
);

