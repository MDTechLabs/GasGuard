import axios from "axios";
import { CacheService } from "../../cache/cache.service";
import { EvmOpcodeCalculator } from "./evm-opcode-calculator";
import { SorobanResourceCalculator } from "./soroban-resource-calculator";

export interface EvaluationInput {
  language: "solidity" | "soroban";
  ruleName: string;
  occurrences?: number;
  annualExecutionVolume: number;
  params?: {
    loopIterations?: number;
    isCold?: boolean;
    byteSize?: number;
    numberOfTopics?: number;
    dataSize?: number;
    numberOfReads?: number;
  };
  gasPriceGweiOrStroop?: number; // Optional user override for gas price (Gwei for EVM, Stroop per unit for Soroban)
}

export interface EvaluationResult {
  language: "solidity" | "soroban";
  ruleName: string;
  deltaGasOrStroops: number; // Gas units for EVM, Stroops for Soroban
  nativeTokenSavedPerExecution: number; // ETH or XLM
  usdSavedPerExecution: number;
  estimatedAnnualNativeSavings: number;
  estimatedAnnualUsdSavings: number;
  tokenPriceUsd: number;
  description: string;
}

export class GasDeltaEvaluator {
  private readonly evmCalculator = new EvmOpcodeCalculator();
  private readonly sorobanCalculator = new SorobanResourceCalculator();
  private cacheService: CacheService | null = null;

  // Cache duration of 60 seconds (1 minute)
  private readonly CACHE_TTL = 60;

  // Standard fallback prices for 2026
  private readonly FALLBACK_ETH_PRICE = 3500;
  private readonly FALLBACK_XLM_PRICE = 0.12;

  // Default gas/fee rates
  private readonly DEFAULT_EVM_L2_GAS_PRICE_GWEI = 0.1; // Typical L2 (Base/Optimism) fee level
  private readonly DEFAULT_SOROBAN_BASE_FEE_RATE = 100; // Stroops base multiplier

  constructor(cacheService?: CacheService) {
    if (cacheService) {
      this.cacheService = cacheService;
    } else if (process.env.NODE_ENV !== "test") {
      try {
        this.cacheService = new CacheService();
      } catch {
        // Gracefully handle environments without Redis configured
        this.cacheService = null;
      }
    }
  }

  /**
   * Fetches the current native token price in USD (ETH or XLM) using cached pricing
   */
  public async getNativeTokenPrice(token: "ETH" | "XLM"): Promise<number> {
    const cacheKey = `price:${token.toLowerCase()}`;
    const coinId = token === "ETH" ? "ethereum" : "stellar";
    const fallbackPrice = token === "ETH" ? this.FALLBACK_ETH_PRICE : this.FALLBACK_XLM_PRICE;

    // Try to read from cache if service is initialized
    if (this.cacheService) {
      try {
        const cachedVal = await this.cacheService.get<number>(cacheKey);
        if (cachedVal !== null && cachedVal !== undefined) {
          return cachedVal;
        }
      } catch {
        // Suppress and fall through on cache storage read failure
      }
    }

    // Fetch from CoinGecko API
    try {
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
        { timeout: 5000 }
      );
      const price = response.data[coinId]?.usd;
      if (typeof price === "number") {
        if (this.cacheService) {
          try {
            await this.cacheService.set(cacheKey, price, this.CACHE_TTL);
          } catch {
            // Suppress cache set error
          }
        }
        return price;
      }
    } catch {
      // Fallback on network or API failure
    }

    return fallbackPrice;
  }

  /**
   * Evaluates the delta gas and estimates cost reductions in USD and native tokens
   */
  public async evaluateDelta(input: EvaluationInput): Promise<EvaluationResult> {
    const occurrences = input.occurrences || 1;
    const annualVolume = input.annualExecutionVolume;
    const params = input.params || {};

    let deltaGasOrStroops = 0;
    let nativeTokenSavedPerExecution = 0;
    let usdSavedPerExecution = 0;
    let tokenPriceUsd = 0;
    let description = "";

    if (input.language === "solidity") {
      tokenPriceUsd = await this.getNativeTokenPrice("ETH");
      const evmResult = this.evmCalculator.calculateDelta(input.ruleName, occurrences, params);
      deltaGasOrStroops = evmResult.deltaGas;
      description = evmResult.description;

      // Calculate ETH amount saved per execution
      // Gas * gasPriceGwei * 10^-9 ETH/Gwei
      const gasPriceGwei = input.gasPriceGweiOrStroop || this.DEFAULT_EVM_L2_GAS_PRICE_GWEI;
      nativeTokenSavedPerExecution = deltaGasOrStroops * (gasPriceGwei / 1e9);
      usdSavedPerExecution = nativeTokenSavedPerExecution * tokenPriceUsd;
    } else if (input.language === "soroban") {
      tokenPriceUsd = await this.getNativeTokenPrice("XLM");
      const sorobanResult = this.sorobanCalculator.calculateDelta(input.ruleName, occurrences, params);
      deltaGasOrStroops = sorobanResult.deltaFeeStroops;
      description = sorobanResult.description;

      // Calculate XLM amount saved per execution (1 XLM = 10^7 stroops)
      nativeTokenSavedPerExecution = deltaGasOrStroops / 1e7;
      usdSavedPerExecution = nativeTokenSavedPerExecution * tokenPriceUsd;
    } else {
      throw new Error(`Unsupported smart contract language: ${input.language}`);
    }

    const estimatedAnnualNativeSavings = nativeTokenSavedPerExecution * annualVolume;
    const estimatedAnnualUsdSavings = usdSavedPerExecution * annualVolume;

    return {
      language: input.language,
      ruleName: input.ruleName,
      deltaGasOrStroops,
      nativeTokenSavedPerExecution,
      usdSavedPerExecution,
      estimatedAnnualNativeSavings: parseFloat(estimatedAnnualNativeSavings.toFixed(6)),
      estimatedAnnualUsdSavings: parseFloat(estimatedAnnualUsdSavings.toFixed(2)),
      tokenPriceUsd,
      description,
    };
  }
}
