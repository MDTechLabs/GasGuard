export interface SimulationResult {
  gasUsed: number;
  opcodes: OpcodeTrace[];
  reverted: boolean;
  returnValue?: string;
  error?: string;
}

export interface OpcodeTrace {
  opcode: string;
  gasCost: number;
  pc: number;
  depth: number;
}

export interface ChainAdapter {
  simulate(code: string, method: string, params: any[]): Promise<SimulationResult>;
  getChainId(): string;
}
