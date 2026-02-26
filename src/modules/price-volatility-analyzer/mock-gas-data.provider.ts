import { GasDataProvider, RawGasData } from '../src/gas-volatility/interfaces/gas-volatility.interfaces';

let blockCounter = 19_000_000;

/**
 * Generates realistic-looking gas price data with configurable volatility.
 */
export class MockGasDataProvider implements GasDataProvider {
  private baseFeeMean: number;
  private volatilityFactor: number;

  constructor(baseFeeMean = 30e9 /* 30 Gwei */, volatilityFactor = 0.2) {
    this.baseFeeMean = baseFeeMean;
    this.volatilityFactor = volatilityFactor;
  }

  async fetchLatestGasData(chainId: number): Promise<RawGasData> {
    return this.generateRecord(chainId, new Date());
  }

  async fetchHistoricalGasData(
    chainId: number,
    from: Date,
    to: Date,
  ): Promise<RawGasData[]> {
    const records: RawGasData[] = [];
    const intervalMs = 12_000; // ~12 s per block
    let current = from.getTime();

    while (current <= to.getTime()) {
      records.push(this.generateRecord(chainId, new Date(current)));
      current += intervalMs;
    }

    return records;
  }

  generateTimeSeries(
    chainId: number,
    count: number,
    intervalMs = 3_600_000,
    startOffset = 0,
  ): RawGasData[] {
    const now = Date.now();
    return Array.from({ length: count }, (_, i) => {
      const ts = new Date(now - (count - i) * intervalMs + startOffset);
      return this.generateRecord(chainId, ts);
    });
  }

  /** Produce a record with explicit gas price in Gwei */
  generateRecordWithPrice(chainId: number, gasPriceGwei: number, timestamp: Date): RawGasData {
    const baseFee = BigInt(Math.round(gasPriceGwei * 0.8 * 1e9));
    const priorityFee = BigInt(Math.round(gasPriceGwei * 0.2 * 1e9));
    return {
      chainId,
      blockNumber: (blockCounter++).toString(),
      baseFee: baseFee.toString(),
      priorityFee: priorityFee.toString(),
      gasUsed: '15000000',
      gasLimit: '30000000',
      timestamp,
    };
  }

  private generateRecord(chainId: number, timestamp: Date): RawGasData {
    const noise = 1 + (Math.random() - 0.5) * 2 * this.volatilityFactor;
    const baseFee = BigInt(Math.round(this.baseFeeMean * noise * 0.8));
    const priorityFee = BigInt(Math.round(this.baseFeeMean * 0.2));

    return {
      chainId,
      blockNumber: (blockCounter++).toString(),
      baseFee: baseFee.toString(),
      priorityFee: priorityFee.toString(),
      gasUsed: String(15_000_000 + Math.floor(Math.random() * 5_000_000)),
      gasLimit: '30000000',
      timestamp,
    };
  }
}
