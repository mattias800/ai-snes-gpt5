// IPL ROM client for uploading data and code to SPC700
// Based on the reference implementation from spc-player

export class IplRomClient {
  private firstTransfer = true;
  private writeCounter = 0;
  
  constructor(
    private cpuWrite: (port: number, value: number) => void,
    private cpuRead: (port: number) => number,
    private stepApu?: (cycles: number) => void
  ) {}
  
  reset(): boolean {
    this.writeCounter = 0;
    this.firstTransfer = true;
    
    // Wait for SPC to be ready (should see AA/BB pattern)
    if (!this.waitForInput(0, 0xAA, 10000)) return false;
    if (!this.waitForInput(1, 0xBB, 10000)) return false;
    return true;
  }
  
  setAddress(address: number): boolean {
    this.cpuWrite(1, 1);
    this.cpuWrite(2, address & 0xFF);
    this.cpuWrite(3, (address >> 8) & 0xFF);
    
    if (this.firstTransfer) {
      this.writeCounter = 0xCC;
      this.cpuWrite(0, this.writeCounter);
      if (!this.waitForInput(0, this.writeCounter, 10000)) {
        return false;
      }
      this.firstTransfer = false;
    } else {
      this.writeCounter += 2;
      // Next value cannot be zero
      if (this.writeCounter === 0) {
        this.writeCounter = 1;
      }
      this.cpuWrite(0, this.writeCounter);
      if (!this.waitForInput(0, this.writeCounter, 10000)) {
        return false;
      }
    }
    this.writeCounter = 0;
    return true;
  }
  
  write(value: number): boolean {
    this.cpuWrite(1, value & 0xFF);
    this.cpuWrite(0, this.writeCounter);
    
    if (!this.waitForInput(0, this.writeCounter, 10000)) {
      return false;
    }
    this.writeCounter++;
    return true;
  }
  
  writeBlock(data: Uint8Array): boolean {
    for (let i = 0; i < data.length; i++) {
      if (!this.write(data[i])) {
        return false;
      }
    }
    return true;
  }
  
  start(address: number): boolean {
    // Port 0 value needs to be incremented by 2 or more to tell SPC to start execution
    if (this.firstTransfer) {
      this.writeCounter = 0xCC;
      this.firstTransfer = false;
    } else {
      this.writeCounter += 2;
    }
    
    // Write execution address and wait for response
    this.cpuWrite(1, 0x00);
    this.cpuWrite(2, address & 0xFF);
    this.cpuWrite(3, (address >> 8) & 0xFF);
    this.cpuWrite(0, this.writeCounter);
    
    return this.waitForInput(0, this.writeCounter, 50000);
  }
  
  private waitForInput(port: number, expectedValue: number, timeoutCounter: number): boolean {
    let counter = 0;
    let input = expectedValue - 1;
    
    while (input !== expectedValue) {
      if (counter > timeoutCounter) {
        return false;
      }
      counter++;
      
      // Step the APU to let it process
      if (this.stepApu) {
        this.stepApu(10);
      }
      
      input = this.cpuRead(port) & 0xFF;
    }
    return true;
  }
}
