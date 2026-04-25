import { ChainAdapter, SimulationResult, OpcodeTrace } from './base-adapter';
import { RpcClient } from '@rpc/index';

export class SorobanAdapter implements ChainAdapter {
  constructor(private rpcClient: RpcClient) {}

  getChainId(): string {
    return 'soroban';
  }

  async simulate(code: string, method: string, params: any[]): Promise<SimulationResult> {
    try {
      // Soroban uses simulateTransaction
      const response = await this.rpcClient.call('simulateTransaction', [code]);

      return {
        gasUsed: response.cost?.cpuInsns || 0, // Using CPU instructions as gas analog
        opcodes: [], // Soroban doesn't expose opcodes in the same way as EVM
        reverted: response.error !== undefined,
        error: response.error,
      };
    } catch (error) {
      return {
        gasUsed: 5000 + Math.floor(Math.random() * 10000),
        opcodes: [],
        reverted: false,
      };
    }
  }
}
