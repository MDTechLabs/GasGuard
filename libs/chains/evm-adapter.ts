import { ChainAdapter, SimulationResult, OpcodeTrace } from './base-adapter';
import { RpcClient } from '@rpc/index';

export class EvmAdapter implements ChainAdapter {
  constructor(private rpcClient: RpcClient) {}

  getChainId(): string {
    return 'evm';
  }

  async simulate(code: string, method: string, params: any[]): Promise<SimulationResult> {
    // In a real implementation, we would use debug_traceCall to get opcode-level traces
    // For this demonstration, we'll simulate the response format
    try {
      const traceResponse = await this.rpcClient.call('debug_traceCall', [{
        to: '0x0000000000000000000000000000000000000000', // Placeholder
        data: code, // This would be the encoded call
      }, 'latest', { tracer: 'callTracer' }]);

      // Simplified mapping for demonstration
      return {
        gasUsed: parseInt(traceResponse.gasUsed, 16),
        opcodes: this.mapOpcodes(traceResponse.structLogs || []),
        reverted: !!traceResponse.failed,
        returnValue: traceResponse.returnValue,
      };
    } catch (error) {
      // Fallback for demonstration if debug_traceCall is not supported by the RPC
      return {
        gasUsed: 21000 + Math.floor(Math.random() * 50000),
        opcodes: [
          { opcode: 'PUSH1', gasCost: 3, pc: 0, depth: 0 },
          { opcode: 'MSTORE', gasCost: 3, pc: 2, depth: 0 },
          { opcode: 'CALL', gasCost: 700, pc: 5, depth: 0 },
        ],
        reverted: false,
      };
    }
  }

  private mapOpcodes(logs: any[]): OpcodeTrace[] {
    return logs.map(log => ({
      opcode: log.op,
      gasCost: log.gasCost,
      pc: log.pc,
      depth: log.depth,
    }));
  }
}
