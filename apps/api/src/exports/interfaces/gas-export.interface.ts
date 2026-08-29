/**
 * A single transaction row in the gas usage export.
 */
export interface GasUsageRecord {
  merchantId: string;
  wallet: string;
  chain: string;
  chainId: number;
  txHash: string;
  functionSelector: string;
  gasUsed: number;
  /** Gas price in Gwei */
  gasPriceGwei: string;
  /** Cost in native token (ETH / MATIC / BNB …) */
  gasCostNative: string;
  /** Cost in USD */
  gasCostUSD: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  blockNumber: number;
}

/**
 * Report-level metadata prepended as comments in the CSV.
 */
export interface ExportMetadata {
  generatedAt: string;
  filters: {
    merchantId?: string;
    wallet?: string;
    from?: string;
    to?: string;
    chain?: string;
    txType?: string;
  };
  totalRecords: number;
  totalGasCostNative: string;
  totalGasCostUSD: string;
}

/**
 * Column header order – must stay in sync with ExportsService.recordToCsvRow.
 */
export const CSV_HEADERS = [
  "MerchantID",
  "Wallet",
  "Chain",
  "ChainID",
  "TxHash",
  "FunctionSelector",
  "GasUsed",
  "GasPriceGwei",
  "GasCostNative",
  "GasCostUSD",
  "Timestamp",
  "BlockNumber",
] as const;

export type CsvHeader = (typeof CSV_HEADERS)[number];
