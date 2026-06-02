import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ethers } from "ethers";
import { PassThrough } from "stream";
import { GasUsageFilterDto } from "./dto/gas-usage-filter.dto";
import {
  GasUsageRecord,
  ExportMetadata,
  CSV_HEADERS,
} from "./interfaces/gas-export.interface";

@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);

  /** Maps numeric chain ID → human-readable name. */
  private readonly CHAIN_NAMES: Record<number, string> = {
    1: "Ethereum",
    5: "Goerli",
    11155111: "Sepolia",
    137: "Polygon",
    80001: "Mumbai",
    42161: "Arbitrum One",
    421613: "Arbitrum Goerli",
    10: "Optimism",
    420: "Optimism Goerli",
    56: "BNB Chain",
    97: "BNB Testnet",
    43114: "Avalanche",
    250: "Fantom",
    8453: "Base",
    100: "Gnosis",
  };

  /** Reverse lookup: normalised name → chain ID. */
  private readonly CHAIN_IDS_BY_NAME: Record<string, number> =
    Object.fromEntries(
      Object.entries(this.CHAIN_NAMES).map(([id, name]) => [
        name.toLowerCase().replace(/\s+/g, "_"),
        Number(id),
      ]),
    );

  /** Approximate average block times (seconds) per chain for timestamp → block estimation. */
  private readonly AVG_BLOCK_TIME: Record<number, number> = {
    1: 12,
    137: 2,
    42161: 1,
    10: 2,
    56: 3,
    43114: 2,
    8453: 2,
  };

  private readonly DEFAULT_AVG_BLOCK_TIME = 12;
  private readonly DEFAULT_LOOKBACK_DAYS = 30;
  private readonly TX_BATCH_SIZE = 20;
  private readonly LOG_CHUNK_SIZE = 2_000;
  private readonly CSV_WRITE_CHUNK = 500;

  constructor(private readonly configService: ConfigService) {}

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Resolves all records matching `filters`, streams them as a CSV via a
   * PassThrough, and returns both the stream and report-level metadata.
   *
   * @param filters   Query filters from the request.
   * @param walletOverride  Route-param wallet (takes precedence over filters.wallet).
   */
  async generateGasUsageStream(
    filters: GasUsageFilterDto,
    walletOverride?: string,
  ): Promise<{ stream: PassThrough; metadata: ExportMetadata }> {
    const wallet = walletOverride ?? filters.wallet;
    if (!wallet) {
      throw new BadRequestException(
        "A wallet address is required. Provide it as a query param or route segment.",
      );
    }

    const provider = this.buildProvider(filters.rpcUrl);
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);

    // Apply chain filter early to avoid unnecessary RPC calls
    const targetChainId = this.resolveChainId(filters.chain);
    if (targetChainId !== null && chainId !== targetChainId) {
      throw new BadRequestException(
        `The configured RPC endpoint is on chain ${chainId}, ` +
          `but you requested chain ${filters.chain} (${targetChainId}).`,
      );
    }

    const { fromBlock, toBlock, fromTimestamp, toTimestamp } =
      await this.resolveBlockRange(provider, chainId, filters.from, filters.to);

    const nativeUsdPrice = await this.fetchNativeTokenUsdPrice(chainId);
    const merchantId = filters.merchantId ?? wallet;
    const chainName = this.CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;

    const records = await this.collectGasRecords(
      provider,
      ethers.getAddress(wallet),
      merchantId,
      chainId,
      chainName,
      fromBlock,
      toBlock,
      fromTimestamp,
      toTimestamp,
      nativeUsdPrice,
    );

    if (!records.length) {
      throw new BadRequestException(
        "No transactions found for the given filters. " +
          "Try widening the date range or verifying the wallet address.",
      );
    }

    const totalNative = records.reduce(
      (s, r) => s + parseFloat(r.gasCostNative),
      0,
    );
    const totalUsd = records.reduce((s, r) => s + parseFloat(r.gasCostUSD), 0);

    const metadata: ExportMetadata = {
      generatedAt: new Date().toISOString(),
      filters: {
        merchantId: filters.merchantId,
        wallet,
        from: filters.from,
        to: filters.to,
        chain: filters.chain,
        txType: filters.txType,
      },
      totalRecords: records.length,
      totalGasCostNative: totalNative.toFixed(8),
      totalGasCostUSD: totalUsd.toFixed(2),
    };

    const stream = this.buildCsvStream(records, metadata);
    return { stream, metadata };
  }

  // ─── CSV Streaming ────────────────────────────────────────────────────────

  /**
   * Writes metadata comments, the header row, then all data rows into a
   * PassThrough stream. Respects backpressure via drain events.
   */
  private buildCsvStream(
    records: GasUsageRecord[],
    metadata: ExportMetadata,
  ): PassThrough {
    const pass = new PassThrough();

    setImmediate(async () => {
      try {
        // ── Metadata block ──────────────────────────────────────────────────
        pass.write(`# Gas Usage Export Report\n`);
        pass.write(`# Generated: ${metadata.generatedAt}\n`);
        pass.write(`# Total Records: ${metadata.totalRecords}\n`);
        pass.write(
          `# Total Gas Cost (Native): ${metadata.totalGasCostNative}\n`,
        );
        pass.write(`# Total Gas Cost (USD): $${metadata.totalGasCostUSD}\n`);

        if (metadata.filters.merchantId)
          pass.write(`# Merchant: ${metadata.filters.merchantId}\n`);
        if (metadata.filters.wallet)
          pass.write(`# Wallet: ${metadata.filters.wallet}\n`);
        if (metadata.filters.from || metadata.filters.to)
          pass.write(
            `# Date Range: ${metadata.filters.from ?? "N/A"} → ${metadata.filters.to ?? "N/A"}\n`,
          );
        if (metadata.filters.chain)
          pass.write(`# Chain: ${metadata.filters.chain}\n`);
        if (metadata.filters.txType)
          pass.write(`# Tx Type Filter: ${metadata.filters.txType}\n`);

        pass.write(`\n`);

        // ── Header row ──────────────────────────────────────────────────────
        pass.write(CSV_HEADERS.join(",") + "\n");

        // ── Data rows (chunked to respect backpressure) ─────────────────────
        for (let i = 0; i < records.length; i += this.CSV_WRITE_CHUNK) {
          const lines = records
            .slice(i, i + this.CSV_WRITE_CHUNK)
            .map((r) => this.recordToCsvRow(r))
            .join("\n");

          const canContinue = pass.write(lines + "\n");
          if (!canContinue) {
            await new Promise<void>((resolve) => pass.once("drain", resolve));
          }
        }

        pass.end();
      } catch (err) {
        pass.destroy(err as Error);
      }
    });

    return pass;
  }

  /**
   * Serialises one GasUsageRecord into a CSV row.
   * Column order must match CSV_HEADERS exactly.
   */
  private recordToCsvRow(r: GasUsageRecord): string {
    return [
      this.escapeCsv(r.merchantId),
      this.escapeCsv(r.wallet),
      this.escapeCsv(r.chain),
      r.chainId,
      this.escapeCsv(r.txHash),
      this.escapeCsv(r.functionSelector),
      r.gasUsed,
      this.escapeCsv(r.gasPriceGwei),
      this.escapeCsv(r.gasCostNative),
      this.escapeCsv(r.gasCostUSD),
      this.escapeCsv(r.timestamp),
      r.blockNumber,
    ].join(",");
  }

  private escapeCsv(value: string | number): string {
    const str = String(value ?? "");
    return str.includes(",") || str.includes('"') || str.includes("\n")
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  }

  // ─── Transaction Collection ───────────────────────────────────────────────

  private async collectGasRecords(
    provider: ethers.JsonRpcProvider,
    wallet: string,
    merchantId: string,
    chainId: number,
    chainName: string,
    fromBlock: number,
    toBlock: number,
    fromTimestamp: number,
    toTimestamp: number,
    nativeUsdPrice: number,
  ): Promise<GasUsageRecord[]> {
    const txHashes = await this.collectWalletTxHashes(
      provider,
      wallet,
      fromBlock,
      toBlock,
    );
    if (!txHashes.length) return [];

    const records: GasUsageRecord[] = [];

    for (let i = 0; i < txHashes.length; i += this.TX_BATCH_SIZE) {
      const batch = txHashes.slice(i, i + this.TX_BATCH_SIZE);
      const settled = await Promise.allSettled(
        batch.map((hash) =>
          this.parseTxToRecord(
            provider,
            hash,
            wallet,
            merchantId,
            chainId,
            chainName,
            nativeUsdPrice,
            fromTimestamp,
            toTimestamp,
          ),
        ),
      );

      for (const result of settled) {
        if (result.status === "fulfilled" && result.value) {
          records.push(result.value);
        }
      }
    }

    // Sort chronologically (oldest → newest) for finance teams
    return records.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
  }

  /**
   * Scans event logs to collect unique transaction hashes.
   * Uses chunked getLogs to stay within provider limits.
   */
  private async collectWalletTxHashes(
    provider: ethers.JsonRpcProvider,
    wallet: string,
    fromBlock: number,
    toBlock: number,
  ): Promise<string[]> {
    const hashes = new Set<string>();

    for (
      let start = fromBlock;
      start <= toBlock;
      start += this.LOG_CHUNK_SIZE
    ) {
      const end = Math.min(toBlock, start + this.LOG_CHUNK_SIZE - 1);
      try {
        const logs = await provider.getLogs({ fromBlock: start, toBlock: end });
        for (const log of logs) {
          hashes.add(log.transactionHash);
        }
      } catch (err) {
        this.logger.debug(
          `Skipped log chunk [${start}–${end}]: ${(err as Error).message}`,
        );
      }
    }

    return [...hashes];
  }

  private async parseTxToRecord(
    provider: ethers.JsonRpcProvider,
    hash: string,
    wallet: string,
    merchantId: string,
    chainId: number,
    chainName: string,
    nativeUsdPrice: number,
    fromTimestamp: number,
    toTimestamp: number,
  ): Promise<GasUsageRecord | null> {
    try {
      const [tx, receipt] = await Promise.all([
        provider.getTransaction(hash),
        provider.getTransactionReceipt(hash),
      ]);

      if (!tx || !receipt) return null;

      // Only include outbound transactions from this wallet
      if (tx.from?.toLowerCase() !== wallet.toLowerCase()) return null;

      const block = await provider.getBlock(receipt.blockNumber);
      if (!block) return null;

      const txTimestamp = block.timestamp; // Unix seconds
      if (txTimestamp < fromTimestamp || txTimestamp > toTimestamp) return null;

      const gasUsed = Number(receipt.gasUsed);
      const gasPrice = receipt.gasPrice ?? tx.gasPrice ?? 0n;
      const gasPriceGwei = parseFloat(
        ethers.formatUnits(gasPrice, "gwei"),
      ).toFixed(4);
      const gasCostNative = parseFloat(
        ethers.formatEther(receipt.gasUsed * gasPrice),
      ).toFixed(8);
      const gasCostUSD = (parseFloat(gasCostNative) * nativeUsdPrice).toFixed(
        6,
      );

      const inputData = tx.data ?? "0x";
      const functionSelector =
        inputData.length >= 10 ? inputData.slice(0, 10).toLowerCase() : "0x";

      return {
        merchantId,
        wallet,
        chain: chainName,
        chainId,
        txHash: hash,
        functionSelector,
        gasUsed,
        gasPriceGwei,
        gasCostNative,
        gasCostUSD,
        timestamp: new Date(txTimestamp * 1000).toISOString(),
        blockNumber: receipt.blockNumber,
      };
    } catch (err) {
      this.logger.debug(`Skipped tx ${hash}: ${(err as Error).message}`);
      return null;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private buildProvider(rpcUrl?: string): ethers.JsonRpcProvider {
    const url =
      rpcUrl ??
      this.configService.get<string>("RPC_URL") ??
      this.configService.get<string>("ETHEREUM_RPC_URL");

    if (!url) {
      throw new BadRequestException(
        "No RPC URL configured. Provide rpcUrl in the request or set RPC_URL in .env.",
      );
    }

    return new ethers.JsonRpcProvider(url);
  }

  /**
   * Estimates the fromBlock / toBlock range from ISO date strings.
   * Uses per-chain average block times for accuracy.
   */
  private async resolveBlockRange(
    provider: ethers.JsonRpcProvider,
    chainId: number,
    from?: string,
    to?: string,
  ): Promise<{
    fromBlock: number;
    toBlock: number;
    fromTimestamp: number;
    toTimestamp: number;
  }> {
    const latestBlock = await provider.getBlockNumber();
    const nowSec = Math.floor(Date.now() / 1000);

    const toTimestamp = to ? Math.floor(new Date(to).getTime() / 1000) : nowSec;
    const fromTimestamp = from
      ? Math.floor(new Date(from).getTime() / 1000)
      : toTimestamp - this.DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60;

    const avgBlockTime =
      this.AVG_BLOCK_TIME[chainId] ?? this.DEFAULT_AVG_BLOCK_TIME;
    const blocksBack = Math.ceil((toTimestamp - fromTimestamp) / avgBlockTime);

    return {
      fromBlock: Math.max(0, latestBlock - blocksBack),
      toBlock: latestBlock,
      fromTimestamp,
      toTimestamp,
    };
  }

  private resolveChainId(chain?: string): number | null {
    if (!chain) return null;
    const asNumber = parseInt(chain, 10);
    if (!isNaN(asNumber)) return asNumber;
    return (
      this.CHAIN_IDS_BY_NAME[chain.toLowerCase().replace(/\s+/g, "_")] ?? null
    );
  }

  /**
   * Fetches the native token USD price from CoinGecko.
   * Falls back to ETH_USD_PRICE env var, then 2 500 USD.
   */
  private async fetchNativeTokenUsdPrice(chainId: number): Promise<number> {
    const coinGeckoIds: Record<number, string> = {
      1: "ethereum",
      5: "ethereum",
      11155111: "ethereum",
      137: "matic-network",
      80001: "matic-network",
      42161: "ethereum",
      10: "ethereum",
      56: "binancecoin",
      97: "binancecoin",
      43114: "avalanche-2",
      250: "fantom",
      8453: "ethereum",
      100: "xdai",
    };

    const coinId = coinGeckoIds[chainId] ?? "ethereum";

    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
      );
      if (!res.ok) throw new Error(`CoinGecko responded with ${res.status}`);
      const data = (await res.json()) as Record<string, { usd: number }>;
      return data[coinId]?.usd ?? this.fallbackUsdPrice();
    } catch (err) {
      this.logger.warn(
        `Failed to fetch USD price for coinId="${coinId}": ${(err as Error).message}. Using fallback.`,
      );
      return this.fallbackUsdPrice();
    }
  }

  private fallbackUsdPrice(): number {
    return this.configService.get<number>("ETH_USD_PRICE") ?? 2500;
  }
}
