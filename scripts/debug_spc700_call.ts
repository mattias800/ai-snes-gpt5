import { APUDevice } from "../src/apu/apu";

function log(apu: any, label: string) {
  console.log(label, {
    PC: apu.smp.PC.toString(16),
    SP: apu.smp.SP.toString(16),
    A: apu.smp.A.toString(16),
    Y: apu.smp.Y.toString(16),
    PSW: apu.smp.PSW.toString(16),
  });
}

function runCallRet() {
  const apu: any = new APUDevice();
  const main = 0x0b00;
  const sub = 0x0b20;

  apu.aram[main + 0] = 0x3f;
  apu.aram[main + 1] = sub & 0xff;
  apu.aram[main + 2] = (sub >>> 8) & 0xff;
  apu.aram[main + 3] = 0xe8;
  apu.aram[main + 4] = 0x55;

  apu.aram[sub + 0] = 0xe8; apu.aram[sub + 1] = 0x77;
  apu.aram[sub + 2] = 0xc5; apu.aram[sub + 3] = 0x20;
  apu.aram[sub + 4] = 0x6f;

  apu.smp.PC = main;
  log(apu, "start");

  // Step CALL
  apu.smp.stepInstruction();
  log(apu, "after CALL");
  // Step within sub: MOV A,#
  apu.smp.stepInstruction();
  log(apu, "after MOV A,# in sub");
  // MOV $20,A
  apu.smp.stepInstruction();
  log(apu, "after MOV dp,A in sub");
  // RET
  apu.smp.stepInstruction();
  log(apu, "after RET");
  // Back in main: MOV A,#
  apu.smp.stepInstruction();
  log(apu, "after MOV A,# in main");
}

runCallRet();

function runCallRetViaDeviceStep() {
  const apu: any = new APUDevice();
  const main = 0x0b00;
  const sub = 0x0b20;

  apu.aram[main + 0] = 0x3f;
  apu.aram[main + 1] = sub & 0xff;
  apu.aram[main + 2] = (sub >>> 8) & 0xff;
  apu.aram[main + 3] = 0xe8;
  apu.aram[main + 4] = 0x55;

  apu.aram[sub + 0] = 0xe8; apu.aram[sub + 1] = 0x77;
  apu.aram[sub + 2] = 0xc5; apu.aram[sub + 3] = 0x20;
  apu.aram[sub + 4] = 0x6f;

  apu.smp.PC = main;
  log(apu, "[dev] start");
  apu.step(256);
  log(apu, "[dev] after step 256");
  console.log("mem20:", apu.aram[0x20]);
}

runCallRetViaDeviceStep();

function runTraceLoop() {
  const apu: any = new APUDevice();
  const main = 0x0b00;
  const sub = 0x0b20;

  apu.aram[main + 0] = 0x3f;
  apu.aram[main + 1] = sub & 0xff;
  apu.aram[main + 2] = (sub >>> 8) & 0xff;
  apu.aram[main + 3] = 0xe8;
  apu.aram[main + 4] = 0x55;

  apu.aram[sub + 0] = 0xe8; apu.aram[sub + 1] = 0x77;
  apu.aram[sub + 2] = 0xc5; apu.aram[sub + 3] = 0x20;
  apu.aram[sub + 4] = 0x6f;

  apu.smp.PC = main;
  let budget = 256;
  let stepCount = 0;
  while (budget > 0 && stepCount < 300) {
    const pc = apu.smp.PC >>> 0;
    const op = apu.aram[pc] >>> 0;
    const consumed = apu.smp.stepInstruction() | 0;
    budget -= consumed > 0 ? consumed : 2;
    console.log(`step ${stepCount}: PC=${pc.toString(16)} OP=${op.toString(16)} consumed=${consumed} -> PC'=${(apu.smp.PC>>>0).toString(16)} SP=${apu.smp.SP.toString(16)} A=${apu.smp.A.toString(16)}`);
    stepCount++;
  }
}

runTraceLoop();

function runMovwRoundTrip() {
  const apu: any = new APUDevice();
  const pc = 0x0c00;
  apu.smp.A = 0x12; apu.smp.Y = 0x34;
  apu.aram[pc + 0] = 0xda; apu.aram[pc + 1] = 0x40; // MOVW $40,YA
  apu.aram[pc + 2] = 0xe8; apu.aram[pc + 3] = 0x00; // MOV A,#0
  apu.aram[pc + 4] = 0xe8; apu.aram[pc + 5] = 0x00; // MOV A,#0
  apu.smp.Y = 0x00;
  apu.aram[pc + 6] = 0xba; apu.aram[pc + 7] = 0x40; // MOVW YA,$40

  apu.smp.PC = pc;
  let budget = 13;
  while (budget > 0) {
    const consumed = apu.smp.stepInstruction() | 0;
    budget -= consumed > 0 ? consumed : 2;
  }

  console.log("MOVW round-trip:", { A: apu.smp.A.toString(16), Y: apu.smp.Y.toString(16), mem40: apu.aram[0x40], mem41: apu.aram[0x41] });
}

runMovwRoundTrip();

function runMulDiv() {
  const apu: any = new APUDevice();
  const pc = 0x0cc0;
  apu.smp.Y = 0x34; apu.smp.A = 0x12;
  apu.aram[pc + 0] = 0xcf; // MUL YA
  apu.aram[pc + 1] = 0xe8; apu.aram[pc + 2] = 0x00; // dummy
  apu.smp.X = 0x12;
  apu.aram[pc + 3] = 0x9e; // DIV YA,X
  apu.smp.PC = pc;
  let budget = 23;
  while (budget > 0) {
    const consumed = apu.smp.stepInstruction() | 0;
    budget -= consumed > 0 ? consumed : 2;
  }
  console.log("MUL/DIV:", { YA: ((apu.smp.Y << 8) | apu.smp.A).toString(16), A: apu.smp.A.toString(16), Y: apu.smp.Y.toString(16) });
}

runMulDiv();

