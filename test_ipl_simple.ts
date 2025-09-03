#!/usr/bin/env tsx
import { APUDevice } from './src/apu/apu';

const apu = new APUDevice();

// Disable boot IPL HLE that might interfere
apu.setBootIplHle(false);

// Reset APU
apu.reset();

console.log('Testing IPL ROM protocol...\n');

// Step to let IPL ROM initialize
for (let i = 0; i < 1000; i++) {
  apu.step(10);
}

// Check for AA/BB pattern
const p0 = apu.cpuReadPort(0);
const p1 = apu.cpuReadPort(1);

console.log('Port 0: 0x' + p0.toString(16));
console.log('Port 1: 0x' + p1.toString(16));

if (p0 === 0xAA && p1 === 0xBB) {
  console.log('\n✓ IPL ROM ready signal detected!\n');
  
  // Try simple upload test
  console.log('Testing simple upload...');
  
  // Send first transfer signal
  apu.cpuWritePort(1, 1);      // non-zero to indicate address
  apu.cpuWritePort(2, 0x00);   // address low
  apu.cpuWritePort(3, 0x02);   // address high (0x0200)
  apu.cpuWritePort(0, 0xCC);   // first transfer marker
  
  // Wait for echo
  let received = false;
  for (let i = 0; i < 1000; i++) {
    apu.step(10);
    if (apu.cpuReadPort(0) === 0xCC) {
      received = true;
      break;
    }
  }
  
  if (received) {
    console.log('✓ Address set acknowledged');
    
    // Try to write a byte
    apu.cpuWritePort(1, 0x42);  // data byte
    apu.cpuWritePort(0, 0x00);  // counter = 0
    
    // Wait for echo
    received = false;
    for (let i = 0; i < 1000; i++) {
      apu.step(10);
      if (apu.cpuReadPort(0) === 0x00) {
        received = true;
        break;
      }
    }
    
    if (received) {
      console.log('✓ Data byte written');
      
      // Check if the byte was actually written
      const written = apu.aram[0x0200];
      if (written === 0x42) {
        console.log('✓ Verified: byte 0x42 written to address 0x0200');
      } else {
        console.log('✗ Verification failed: expected 0x42, got 0x' + written.toString(16));
      }
    } else {
      console.log('✗ Data write not acknowledged');
    }
    
  } else {
    console.log('✗ Address set not acknowledged');
  }
  
} else {
  console.log('\n✗ IPL ROM not responding correctly');
  console.log('Expected: Port 0=0xAA, Port 1=0xBB');
}
