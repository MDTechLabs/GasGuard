import { Injectable, Logger } from '@nestjs/common';
import { GasDataProvider, RawGasData } from '../interfaces/gas-volatility.interfaces';

/**
 * JsonRpcGasProvider — connects to an EVM-compatible JSON-RPC endpoint
 * to fetch real-time and historical gas data.
 *
 * Replace `rpcUrl` via config in production.
 * In tests, this is swapped for MockGasDataProvider.
 */
@Injectable()
export class JsonRpcGasProvider implements GasDataProvider {
  private readonly logger = new Logger(JsonRpcGasProvider.name);

  constructor(private readonly rpcUrl: string) {}

  async fetchLatestGasData(chainId: number): Promise<RawGasData> {
    const [block] = await this.rpcCall<[{ baseFeePerGas: string; number: string; gasUsed: string; gasLimit: string }]>(
      'eth_getBlockByNumber',
      ['latest', false],
    );

    return {
      chainId,
      blockNumber: parseInt(block.number, 16).toString(),
      baseFee: BigInt(block.baseFeePerGas).toString(),
      priorityFee: BigInt('1500000000').toString(), // 1.5 Gwei tip as fallback
      gasUsed: BigInt(block.gasUsed).toString(),
      gasLimit: BigInt(block.gasLimit).toString(),
      timestamp: new Date(),
    };
  }

  async fetchHistoricalGasData(
    chainId: number,
    from: Date,
    to: Date,
  ): Promise<RawGasData[]> {
    // Production implementation would use a block explorer API
    // (e.g. Etherscan, Alchemy, Infura) to retrieve blocks in range.
    // For now we demonstrate the structure; replace with actual HTTP calls.
    this.logger.warn(
      'fetchHistoricalGasData: stub implementation — integrate block explorer API',
    );
    return [];
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });

    if (!res.ok) {
      throw new Error(`JSON-RPC HTTP error: ${res.status}`);
    }

    const json = (await res.json()) as { result: T; error?: { message: string } };

    if (json.error) {
      throw new Error(`JSON-RPC error: ${json.error.message}`);
    }

    return json.result;
  }
}
