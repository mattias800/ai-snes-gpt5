import { describe, it, expect } from 'vitest';
import { TestMemoryBus } from '../../src/bus/testMemoryBus';
import { CPU65C816 } from '../../src/cpu/cpu65c816';

function write8(bus: TestMemoryBus, bank: number, addr16: number, val: number) {
  bus.write8(((bank & 0xff) << 16) | (addr16 & 0xffff), val & 0xff);
}

function read8(bus: TestMemoryBus, bank: number, addr16: number) {
  return bus.read8(((bank & 0xff) << 16) | (addr16 & 0xffff)) & 0xff;
}

describe('CPU65C816 control/system ops smoke', () => {
  it('PEA pushes high then low, decrements S by 2', () => {
    const bus = new TestMemoryBus();
    const cpu = new CPU65C816(bus);
    cpu.state.E = true; // emulation stack page
    cpu.state.PC = 0x8000; cpu.state.PBR = 0x00;
    cpu.state.S = 0x01ff;
    // PEA #$1234 (F4 34 12)
    write8(bus, 0x00, 0x8000, 0xf4);
    write8(bus, 0x00, 0x8001, 0x34);
    write8(bus, 0x00, 0x8002, 0x12);
    cpu.stepInstruction();
    // high at 0x01ff, low at 0x01fe
    expect(read8(bus, 0x00, 0x01ff)).toBe(0x12);
    expect(read8(bus, 0x00, 0x01fe)).toBe(0x34);
    expect(cpu.state.S & 0xffff).toBe(0x01fd);
  });

  it('PEI (dp) pushes target high then low from D+dp', () => {
    const bus = new TestMemoryBus();
    const cpu = new CPU65C816(bus);
    cpu.state.E = true; cpu.state.PC = 0x8000; cpu.state.PBR = 0x00; cpu.state.S = 0x01ff;
    cpu.state.D = 0x0100;
    // Place pointer at 0x0180 => 0x5678
    write8(bus, 0x00, 0x0180, 0x78);
    write8(bus, 0x00, 0x0181, 0x56);
    // PEI ($80)  D4 80
    write8(bus, 0x00, 0x8000, 0xd4);
    write8(bus, 0x00, 0x8001, 0x80);
    cpu.stepInstruction();
    expect(read8(bus, 0x00, 0x01ff)).toBe(0x56);
    expect(read8(bus, 0x00, 0x01fe)).toBe(0x78);
    expect(cpu.state.S & 0xffff).toBe(0x01fd);
  });

  it('PER pushes PC-relative target (high then low)', () => {
    const bus = new TestMemoryBus();
    const cpu = new CPU65C816(bus);
    cpu.state.E = true; cpu.state.PC = 0x8000; cpu.state.PBR = 0x00; cpu.state.S = 0x01ff;
    // PER +4 (62 04 00) — disp is added to PC after operand fetch => target = 0x8003 + 4 = 0x8007
    write8(bus, 0x00, 0x8000, 0x62);
    write8(bus, 0x00, 0x8001, 0x04);
    write8(bus, 0x00, 0x8002, 0x00);
    cpu.stepInstruction();
    expect(read8(bus, 0x00, 0x01ff)).toBe(0x80);
    expect(read8(bus, 0x00, 0x01fe)).toBe(0x07);
    expect(cpu.state.S & 0xffff).toBe(0x01fd);
  });

  it('BRK vectors to $FFFE in emulation and RTI returns', () => {
    const bus = new TestMemoryBus();
    const cpu = new CPU65C816(bus);
    cpu.state.E = true; cpu.state.PC = 0x8000; cpu.state.PBR = 0x00; cpu.state.S = 0x01ff;
    // Set BRK vector 00:FFFE/FFFF -> 00:1234
    write8(bus, 0x00, 0xfffe, 0x34); write8(bus, 0x00, 0xffff, 0x12);
    // Program: BRK at 8000; vector contains RTI to return
    write8(bus, 0x00, 0x8000, 0x00); // BRK
    write8(bus, 0x00, 0x1234, 0x40); // RTI at vector
    cpu.stepInstruction();
    expect(cpu.state.PC).toBe(0x1234);
    // Execute RTI to return to 8001
    cpu.stepInstruction();
    expect(cpu.state.PC).toBe(0x8001);
  });

  it('WAI halts until IRQ; STP halts permanently', () => {
    const bus = new TestMemoryBus();
    const cpu = new CPU65C816(bus);
    cpu.state.E = true; cpu.state.PC = 0x8000; cpu.state.PBR = 0x00; cpu.state.S = 0x01ff;
    // Seed IRQ vector 00:FFFE -> 00:2000
    write8(bus, 0x00, 0xfffe, 0x00); write8(bus, 0x00, 0xffff, 0x20);
    // WAI then NOP
    write8(bus, 0x00, 0x8000, 0xcb); // WAI
    write8(bus, 0x00, 0x8001, 0xea); // NOP
    cpu.stepInstruction(); // executes WAI
    const pcAfterWai = cpu.state.PC;
    cpu.stepInstruction(); // should be ignored due to WAI
    expect(cpu.state.PC).toBe(pcAfterWai);
    // Fire IRQ: should clear WAI and vector to 0x2000
    cpu.irq();
    expect(cpu.state.PC).toBe(0x2000);

    // Now test STP: place STP at 0x2000 and try to resume with NMI/IRQ
    write8(bus, 0x00, 0x2000, 0xdb); // STP
    cpu.stepInstruction(); // enter stopped
    const pcAfterStp = cpu.state.PC;
    cpu.nmi();
    cpu.irq();
    // Still stopped; PC should not change
    expect(cpu.state.PC).toBe(pcAfterStp);
  });

  it('MVP and MVN copy bytes with correct direction and update A/X/Y', () => {
    const bus = new TestMemoryBus();
    const cpu = new CPU65C816(bus);
    cpu.state.E = false; // widths don’t affect 8-bit memory moves; A as counter
    cpu.state.P = 0; // clear M/X
    cpu.state.PC = 0x8000; cpu.state.PBR = 0x00;
    // Prepare a tiny range in banks 01 (src) and 02 (dst)
    write8(bus, 0x01, 0x1000, 0x11);
    write8(bus, 0x01, 0x1001, 0x22);
    // MVP srcBank=01, dstBank=02 ; with A=1 (copy 2 bytes, dec X/Y)
    cpu.state.A = 0x0001; cpu.state.X = 0x1001; cpu.state.Y = 0x2001;
    write8(bus, 0x00, 0x8000, 0x54); // MVP
    write8(bus, 0x00, 0x8001, 0x02); // dstBank
    write8(bus, 0x00, 0x8002, 0x01); // srcBank
    cpu.stepInstruction();
    // Expect bytes copied backward: from 01:1001,01:1000 to 02:2001,02:2000
    expect(read8(bus, 0x02, 0x2001)).toBe(0x22);
    expect(read8(bus, 0x02, 0x2000)).toBe(0x11);
    // A should have decremented to 0xFFFF (wrap) after finishing
    expect(cpu.state.A & 0xffff).toBe(0xffff);

    // MVN srcBank=01, dstBank=02 ; with A=1 (copy 2 bytes, inc X/Y)
    // Reset positions and data
    write8(bus, 0x01, 0x3000, 0xaa);
    write8(bus, 0x01, 0x3001, 0xbb);
    cpu.state.A = 0x0001; cpu.state.X = 0x3000; cpu.state.Y = 0x4000; cpu.state.PC = 0x8010;
    write8(bus, 0x00, 0x8010, 0x44); // MVN
    write8(bus, 0x00, 0x8011, 0x02); // dstBank
    write8(bus, 0x00, 0x8012, 0x01); // srcBank
    cpu.stepInstruction();
    expect(read8(bus, 0x02, 0x4000)).toBe(0xaa);
    expect(read8(bus, 0x02, 0x4001)).toBe(0xbb);
  });
});
