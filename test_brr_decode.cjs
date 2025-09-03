const { SDSP } = require('./dist/apu/sdsp.js');
const fs = require('fs');

// Create a DSP and attach fake ARAM
const dsp = new SDSP();
const aram = new Uint8Array(0x10000);

// Load the real ARAM content from an SPC
const { APUDevice } = require('./dist/apu/apu.js');
const { loadSpcIntoApu } = require('./dist/apu/spc_loader.js');
const tempApu = new APUDevice();
const spc = fs.readFileSync('test-spc/yoshi.spc');
loadSpcIntoApu(tempApu, spc);
// Copy the ARAM
for (let i = 0; i < 0x10000; i++) {
  aram[i] = tempApu.aram[i];
}

dsp.attachAram(aram);
dsp.setDecodeTrace(200);

// Set up DSP registers for voice 0
// DIR = 128 (0x80)
dsp.writeAddr(0x5d);
dsp.writeData(0x80);

// Voice 0 parameters
dsp.writeAddr(0x00); dsp.writeData(127);  // VOL(L) 
dsp.writeAddr(0x01); dsp.writeData(127);  // VOL(R)
dsp.writeAddr(0x02); dsp.writeData(0x00); // PITCHL 
dsp.writeAddr(0x03); dsp.writeData(0x10); // PITCHH = 0x10 (pitch = 0x1000)
dsp.writeAddr(0x04); dsp.writeData(3);    // SRCN = 3
dsp.writeAddr(0x05); dsp.writeData(0xfe); // ADSR1
dsp.writeAddr(0x06); dsp.writeData(0x6a); // ADSR2
dsp.writeAddr(0x07); dsp.writeData(0xb8); // GAIN

// MVOLL/MVOLR
dsp.writeAddr(0x0c); dsp.writeData(127);
dsp.writeAddr(0x1c); dsp.writeData(127);

// Key on voice 0
dsp.writeAddr(0x4c);
dsp.writeData(0x01);

// Mix several samples to trigger decoding
console.log('Mixing samples...');
for (let i = 0; i < 50; i++) {
  const [l, r] = dsp.mixSample();
  if (i < 10 || l !== 0 || r !== 0) {
    console.log(`Sample ${i}: L=${l} R=${r}`);
  }
}

// Check decode trace
const trace = dsp.getDecodeTrace();
console.log('\nDecode trace (first 50 events):');
let lastAddr = -1;
for (const evt of trace.slice(0, 50)) {
  if (evt.evt === 'hdr') {
    console.log(`HDR addr=0x${evt.addr.toString(16)} hdr=0x${evt.hdr.toString(16)} end=${evt.end} loop=${evt.loop}`);
    lastAddr = evt.addr;
  } else if (evt.evt === 'blk_end') {
    console.log(`BLK_END from=0x${lastAddr.toString(16)} next=0x${evt.next.toString(16)} end=${evt.end} loop=${evt.loop}`);
  } else if (evt.evt === 's' && (evt.s !== 0 || evt.addr !== lastAddr)) {
    if (evt.addr !== lastAddr) {
      console.log(`  [jumped to 0x${evt.addr.toString(16)}]`);
      lastAddr = evt.addr;
    }
    if (evt.s !== 0) {
      console.log(`  s=${evt.s} (n4=${evt.n4} range=${evt.range} f=${evt.f})`);
    }
  }
}
