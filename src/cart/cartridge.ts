export type Mapping = 'lorom' | 'hirom';

export class Cartridge {
  readonly rom: Uint8Array;
  readonly mapping: Mapping;
  readonly sram: Uint8Array | null;

  constructor(params: { rom: Uint8Array; mapping?: Mapping; sramBytes?: number }) {
    this.rom = params.rom;
    this.mapping = params.mapping ?? 'lorom';
    this.sram = params.sramBytes && params.sramBytes > 0 ? new Uint8Array(params.sramBytes) : null;
  }
}

