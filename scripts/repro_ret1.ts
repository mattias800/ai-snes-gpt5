import { APUDevice } from "../src/apu/apu";
import { assembleOne } from "../src/third_party/snesTests/assembleSpc700";

function hex(n: number, w = 2) { return (n >>> 0).toString(16).padStart(w, "0"); }

function main() {
  const apu: any = new APUDevice();
  // Vector 0452 ret1
  const v = {
    A: 0x12,
    X: 0x34,
    Y: 0x56,
    P: 0x00,
    memInitAddr: 0x01ed, // where PSW should be popped from
    expP: 0xff,
  };

  // Init regs
  apu.smp.A = v.A; apu.smp.X = v.X; apu.smp.Y = v.Y; apu.smp.PSW = v.P;

  // Derive SP: SP + 1 = 0xED -> SP = 0xEC
  const spEff = (v.memInitAddr & 0xff) - 1;
  apu.smp.SP = spEff & 0xff;

  // Init memory
  apu.aram[v.memInitAddr] = v.expP;

  // Assemble ret1 at 0x0200
  const pc = 0x0200;
  const code = assembleOne("ret1");
  for (let i = 0; i < code.length; i++) apu.aram[(pc + i) & 0xffff] = code[i];
  apu.smp.PC = pc;

  // Log pre-state
  const sp = apu.smp.SP & 0xff;
  const pswAddr = 0x0100 | ((sp + 1) & 0xff);
  console.log("pre:", { PC: hex(apu.smp.PC, 4), SP: hex(apu.smp.SP), PSW: hex(apu.smp.PSW), op: hex(apu.aram[pc]), pswMem: hex(apu.aram[pswAddr]) });

  // Step exactly one instruction
  apu.smp.stepInstruction();

  const pswAfter = apu.smp.PSW & 0xff;
  const spAfter = apu.smp.SP & 0xff;
  const loAddr = 0x0100 | ((sp + 2) & 0xff);
  const hiAddr = 0x0100 | ((sp + 3) & 0xff);
  console.log("post:", { PC: hex(apu.smp.PC, 4), SP: hex(spAfter), PSW: hex(pswAfter), loMem: hex(apu.aram[loAddr] ?? 0), hiMem: hex(apu.aram[hiAddr] ?? 0) });
}

main();
