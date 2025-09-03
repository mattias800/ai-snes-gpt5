import { APUDevice } from './apu';
import { IplRomClient } from './ipl_client';
import { SpcBootCode } from './spc_bootcode';

// Load SPC using IPL ROM protocol for proper state restoration
export function loadSpcIntoApuViaIpl(apu: APUDevice, buf: Buffer): boolean {
  if (buf.length < 0x10180) throw new Error('SPC file too small');
  
  const ramStart = 0x100;
  const dspBase = 0x10100;
  
  // Extract CPU registers from SPC header
  const pc = (buf[0x26] << 8) | buf[0x25];
  const a = buf[0x27];
  const x = buf[0x28];
  const y = buf[0x29];
  const psw = buf[0x2a];
  const sp = buf[0x2b];
  
  // Extract IO registers
  const f1 = buf[ramStart + 0xf1];
  const fa = buf[ramStart + 0xfa];
  const fb = buf[ramStart + 0xfb];
  const fc = buf[ramStart + 0xfc];
  
  // Reset APU to clean state
  apu.reset();
  
  // Create IPL ROM client
  const iplClient = new IplRomClient(
    (port, value) => apu.cpuWritePort(port, value),
    (port) => apu.cpuReadPort(port),
    (cycles) => apu.step(cycles)
  );
  
  // Reset and establish communication
  console.log('Establishing IPL ROM communication...');
  if (!iplClient.reset()) {
    console.error('Failed to establish IPL ROM communication');
    return false;
  }
  
  // Build boot code
  const bootCode = new SpcBootCode();
  const bootCodeData = bootCode.build(
    { pc, a, x, y, sp, psw },
    { f1, fa, fb, fc }
  );
  
  // Boot code will be placed at a safe location (0x0100)
  const bootCodeAddr = 0x0100;
  
  console.log(`Uploading boot code (${bootCodeData.length} bytes) to 0x${bootCodeAddr.toString(16)}...`);
  
  // Upload boot code
  if (!iplClient.setAddress(bootCodeAddr)) {
    console.error('Failed to set boot code address');
    return false;
  }
  
  if (!iplClient.writeBlock(bootCodeData)) {
    console.error('Failed to upload boot code');
    return false;
  }
  
  // Upload first page of RAM (0x0002-0x00EF)
  console.log('Uploading first page of RAM...');
  if (!iplClient.setAddress(0x0002)) {
    console.error('Failed to set first page address');
    return false;
  }
  
  for (let i = 0x0002; i < 0x00F0; i++) {
    if (!iplClient.write(buf[ramStart + i])) {
      console.error(`Failed to write RAM at 0x${i.toString(16)}`);
      return false;
    }
  }
  
  // Upload second page of RAM (0x0100-0x01FF) - skip boot code area
  const bootCodeEnd = bootCodeAddr + bootCodeData.length;
  if (bootCodeEnd < 0x0200) {
    console.log('Uploading second page of RAM...');
    if (!iplClient.setAddress(bootCodeEnd)) {
      console.error('Failed to set second page address');
      return false;
    }
    
    for (let i = bootCodeEnd; i < 0x0200; i++) {
      if (!iplClient.write(buf[ramStart + i])) {
        console.error(`Failed to write RAM at 0x${i.toString(16)}`);
        return false;
      }
    }
  }
  
  // Upload rest of RAM (0x0200-0xFFC0)
  console.log('Uploading main RAM (this may take a while)...');
  if (!iplClient.setAddress(0x0200)) {
    console.error('Failed to set main RAM address');
    return false;
  }
  
  // Upload in chunks with progress
  const totalBytes = 0xFFC0 - 0x0200;
  let uploaded = 0;
  
  for (let i = 0x0200; i < 0xFFC0; i++) {
    if (!iplClient.write(buf[ramStart + i])) {
      console.error(`Failed to write RAM at 0x${i.toString(16)}`);
      return false;
    }
    
    uploaded++;
    if (uploaded % 4096 === 0) {
      const percent = Math.round((uploaded / totalBytes) * 100);
      console.log(`  ${percent}% uploaded...`);
    }
  }
  
  // Upload DSP registers
  console.log('Uploading DSP registers...');
  const anyApu: any = apu;
  const dsp = anyApu.dsp;
  
  // Upload all DSP registers except KON/KOF
  for (let i = 0; i < 128; i++) {
    if (i === 0x4c || i === 0x5c) continue; // Skip KON/KOF for now
    dsp.writeAddr(i);
    dsp.writeData(buf[dspBase + i]);
  }
  
  // Upload KOF and KON
  dsp.writeAddr(0x5c);
  dsp.writeData(buf[dspBase + 0x5c]);
  dsp.writeAddr(0x4c);
  dsp.writeData(buf[dspBase + 0x4c]);
  
  // Clear FLG reset/mute bits
  const flg = buf[dspBase + 0x6c] & ~0xc0;
  dsp.writeAddr(0x6c);
  dsp.writeData(flg);
  
  // Start execution of boot code
  console.log('Starting boot code execution...');
  if (!iplClient.start(bootCodeAddr)) {
    console.error('Failed to start boot code');
    return false;
  }
  
  // Wait for boot code acknowledgement (0x23 on port 1)
  let ackReceived = false;
  for (let i = 0; i < 1000; i++) {
    apu.step(100);
    if (apu.cpuReadPort(1) === 0x23) {
      ackReceived = true;
      break;
    }
  }
  
  if (!ackReceived) {
    console.error('Boot code did not send acknowledgement');
    return false;
  }
  
  console.log('Boot code acknowledged, sending final trigger...');
  
  // Send final trigger to complete boot
  apu.cpuWritePort(0, 0x01);
  apu.cpuWritePort(1, 0x00);
  apu.cpuWritePort(2, 0x00);
  apu.cpuWritePort(3, 0x00);
  
  // Step APU to let boot code complete
  for (let i = 0; i < 100; i++) {
    apu.step(32);
  }
  
  console.log('SPC loaded successfully via IPL ROM protocol!');
  return true;
}
