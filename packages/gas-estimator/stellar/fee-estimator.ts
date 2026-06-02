/**
 * Stellar Fee Estimation Engine
 *
 * Estimates Stellar smart contract execution fees based on simulation results
 * and network configuration. Implements the cost model specified in
 * docs/soroban-cost-model-spec.md
 */

import {
  StellarNetworkConfig,
  SimulationResult,
  CPUCost,
  MemoryCost,
  LedgerCost,
  FeeEstimationResult,
  EfficiencyScores,
  FeeEstimationOptions,
  DirectFeeRequest,
  SimulationFeeRequest,
} from "./types";

/**
 * Default network configurations for common Stellar networks
 */
export const DEFAULT_NETWORK_CONFIGS: Record<string, StellarNetworkConfig> = {
  "soroban-mainnet": {
    chainId: "soroban-mainnet",
    chainName: "Soroban Mainnet",
    txMaxInstructions: 100_000_000,
    ledgerMaxInstructions: 1_000_000_000,
    feeRatePerInstructionsIncrement: 10_000,
    feeCPUPerIncrement: 100, // stroops (0.00001 XLM)
    txMemoryLimit: 41_943_040, // 40 MB
    txMaxReadLedgerEntries: 40,
    txMaxReadBytes: 200_000,
    txMaxWriteLedgerEntries: 25,
    txMaxWriteBytes: 100_000,
    feeReadLedgerEntry: 1000, // stroops (0.0001 XLM)
    feeWriteLedgerEntry: 2000, // stroops (0.0002 XLM)
    feeRead1KB: 500, // stroops (0.00005 XLM)
    feeWrite1KB: 1000, // stroops (0.0001 XLM)
    txMaxSizeBytes: 100_000,
    feeTxSize1KB: 100, // stroops (0.00001 XLM)
    version: "mainnet-v20",
  },
  "soroban-testnet": {
    chainId: "soroban-testnet",
    chainName: "Soroban Testnet",
    txMaxInstructions: 100_000_000,
    ledgerMaxInstructions: 1_000_000_000,
    feeRatePerInstructionsIncrement: 10_000,
    feeCPUPerIncrement: 100,
    txMemoryLimit: 41_943_040,
    txMaxReadLedgerEntries: 40,
    txMaxReadBytes: 200_000,
    txMaxWriteLedgerEntries: 25,
    txMaxWriteBytes: 100_000,
    feeReadLedgerEntry: 1000,
    feeWriteLedgerEntry: 2000,
    feeRead1KB: 500,
    feeWrite1KB: 1000,
    txMaxSizeBytes: 100_000,
    feeTxSize1KB: 100,
    version: "testnet-v20",
  },
};

/**
 * Score weights for different resource dimensions
 */
const SCORE_WEIGHTS = {
  cpu: 0.4,
  memory: 0.2,
  ledger: 0.4,
};

/**
 * Ledger utilization weights
 */
const LEDGER_WEIGHTS = [0.2, 0.2, 0.2, 0.2, 0.2]; // r_entries, r_bytes, w_entries, w_bytes, bw

/**
 * Memory scaling factor for penalty calculation
 */
const SCALING_FACTOR_MEMORY = 100;

/**
 * Priority multipliers for safety margins
 */
const PRIORITY_MULTIPLIERS = {
  low: 1.0,
  normal: 1.15,
  high: 1.3,
  critical: 1.5,
};

/**
 * Stellar Fee Estimation Engine
 *
 * Provides accurate execution cost predictions for Stellar smart contracts
 * using simulation-based calculations.
 */
export class StellarFeeEstimator {
  private defaultOptions: Required<FeeEstimationOptions>;

  constructor(options?: FeeEstimationOptions) {
    this.defaultOptions = {
      priority: options?.priority || "normal",
      safetyMargin: options?.safetyMargin || 1.15,
      includeHints: options?.includeHints ?? true,
      includeSafetyChecks: options?.includeSafetyChecks ?? true,
    };
  }

  /**
   * Estimate fees from simulation results
   *
   * @param request - Direct fee estimation request with simulation results
   * @returns Promise resolving to fee estimation result
   */
  async estimateFromSimulation(
    request: DirectFeeRequest,
  ): Promise<FeeEstimationResult> {
    const { simulation, networkConfig, options } = request;
    const mergedOptions = { ...this.defaultOptions, ...options };

    // Validate simulation results
    if (simulation.reverted) {
      throw new Error(
        `Simulation reverted: ${simulation.error || "Unknown error"}`,
      );
    }

    // Calculate costs for each dimension
    const cpuCost = this.computeCPUCost(simulation, networkConfig);
    const memoryCost = this.computeMemoryCost(simulation, networkConfig);
    const ledgerCost = this.computeLedgerCost(simulation, networkConfig);

    // Apply safety margin based on priority
    const priorityMultiplier = PRIORITY_MULTIPLIERS[mergedOptions.priority];
    const safetyMargin = mergedOptions.safetyMargin * priorityMultiplier;

    // Calculate total fees with safety margin
    const baseTotalFee = cpuCost.total + ledgerCost.fee;
    const totalFeeStroops = Math.ceil(baseTotalFee * safetyMargin);
    const totalFeeXLM = totalFeeStroops / 10_000_000; // 1 XLM = 10^7 stroops

    // Compute efficiency scores
    const scores = this.computeScores(cpuCost, memoryCost, ledgerCost);

    // Generate optimization hints
    const optimizationHints = mergedOptions.includeHints
      ? this.generateHints(cpuCost, memoryCost, ledgerCost)
      : [];

    // Check safety violations
    const safetyViolations = mergedOptions.includeSafetyChecks
      ? this.checkSafetyViolations(cpuCost, memoryCost, ledgerCost)
      : [];

    // Calculate confidence based on simulation quality
    const confidence = this.calculateConfidence(simulation, networkConfig);

    return {
      chainId: networkConfig.chainId,
      timestamp: Date.now(),
      cpuCost,
      memoryCost,
      ledgerCost,
      totalFeeStroops,
      totalFeeXLM,
      scores,
      optimizationHints,
      safetyViolations,
      confidence,
    };
  }

  /**
   * Estimate fees by simulating a contract method
   *
   * Note: This requires an actual RPC connection to simulate transactions.
   * In production, this would call the Soroban RPC simulateTransaction endpoint.
   *
   * @param request - Simulation fee request
   * @param simulateFn - Function to perform simulation (injected for testing)
   * @returns Promise resolving to fee estimation result
   */
  async estimateFromContract(
    request: SimulationFeeRequest,
    simulateFn: (
      contractCode: string,
      method: string,
      params: any[],
    ) => Promise<SimulationResult>,
  ): Promise<FeeEstimationResult> {
    const { contractCode, method, params, networkConfig, options } = request;

    if (!contractCode) {
      throw new Error("Contract code is required for simulation");
    }

    // Simulate the contract method
    const simulation = await simulateFn(contractCode, method, params);

    // Estimate fees from simulation results
    return this.estimateFromSimulation({
      simulation,
      networkConfig,
      options,
    });
  }

  /**
   * Compute CPU cost from instruction count
   *
   * Formula: C_cpu_fee = ⌈I / R_cpu⌉ × F_cpu
   * With ledger pressure penalty: C_cpu = C_cpu_fee × (1 + w_ledger × P_cpu_ledger)
   */
  private computeCPUCost(
    simulation: SimulationResult,
    config: StellarNetworkConfig,
  ): CPUCost {
    const instructions = simulation.instructions;
    const limitTx = config.txMaxInstructions;
    const limitLedger = config.ledgerMaxInstructions;

    // Fee calculation
    const feeIncrements = Math.ceil(
      instructions / config.feeRatePerInstructionsIncrement,
    );
    const fee = feeIncrements * config.feeCPUPerIncrement;

    // Utilization calculations
    const utilTx = instructions / limitTx;
    const utilLedger = instructions / limitLedger;

    // Quadratic penalty for disproportionate ledger usage
    const ledgerPressure = Math.pow(utilLedger, 2);

    // Final cost adjusted for pressure (w_ledger = 0.5)
    const pressureWeight = 0.5;
    const totalCost = fee * (1 + pressureWeight * ledgerPressure);

    return {
      fee,
      normalized: utilTx,
      ledgerPressure,
      total: totalCost,
    };
  }

  /**
   * Compute memory cost from peak memory usage
   *
   * Note: Soroban doesn't charge direct fees for memory, but we calculate
   * a penalty score to discourage approaching the hard limit.
   * Formula: cost = k * e^(5 * utilization)
   */
  private computeMemoryCost(
    simulation: SimulationResult,
    config: StellarNetworkConfig,
  ): MemoryCost {
    const memUsed = simulation.memoryBytes;
    const limit = config.txMemoryLimit;

    const utilization = memUsed / limit;

    // Exponential penalty prevents approaching hard limit
    const costScore = SCALING_FACTOR_MEMORY * Math.exp(5 * utilization);

    return {
      bytesUsed: memUsed,
      normalized: utilization,
      costScore,
    };
  }

  /**
   * Compute ledger I/O and bandwidth cost
   *
   * Includes fees for:
   * - Read/write ledger entries
   * - Read/write byte volume
   * - Transaction bandwidth
   */
  private computeLedgerCost(
    simulation: SimulationResult,
    config: StellarNetworkConfig,
  ): LedgerCost {
    const { footprint, readBytes, writeBytes } = simulation.resources;
    const txSize = simulation.transactionSizeBytes;

    // Count reads and writes
    const reads = footprint.readOnly.length;
    const writes = footprint.readWrite.length;

    // Fee components
    const costReads =
      reads * config.feeReadLedgerEntry +
      Math.ceil(readBytes / 1024) * config.feeRead1KB;

    const costWrites =
      writes * config.feeWriteLedgerEntry +
      Math.ceil(writeBytes / 1024) * config.feeWrite1KB;

    const costBandwidth = Math.ceil(txSize / 1024) * config.feeTxSize1KB;

    const totalFee = costReads + costWrites + costBandwidth;

    // Normalized utilization per dimension
    const breakdown = {
      readEntries: reads / config.txMaxReadLedgerEntries,
      readBytes: readBytes / config.txMaxReadBytes,
      writeEntries: writes / config.txMaxWriteLedgerEntries,
      writeBytes: writeBytes / config.txMaxWriteBytes,
      bandwidth: txSize / config.txMaxSizeBytes,
    };

    // Composite score
    const compositeNorm =
      breakdown.readEntries * LEDGER_WEIGHTS[0] +
      breakdown.readBytes * LEDGER_WEIGHTS[1] +
      breakdown.writeEntries * LEDGER_WEIGHTS[2] +
      breakdown.writeBytes * LEDGER_WEIGHTS[3] +
      breakdown.bandwidth * LEDGER_WEIGHTS[4];

    return {
      fee: totalFee,
      normalized: compositeNorm,
      breakdown,
    };
  }

  /**
   * Compute per-dimension and aggregate efficiency scores
   *
   * Scoring bands:
   * - Excellent (100-80): 0% -> 50% utilization
   * - Good (80-50):      50% -> 80% utilization
   * - Poor (50-0):       80% -> 100% utilization
   */
  private computeScores(
    cpu: CPUCost,
    mem: MemoryCost,
    ledger: LedgerCost,
  ): EfficiencyScores {
    const scoreCPU = this.scoreDimension(cpu.normalized);
    const scoreMem = this.scoreDimension(mem.normalized);
    const scoreLedger = this.scoreDimension(ledger.normalized);

    const scoreTotal = Math.round(
      SCORE_WEIGHTS.cpu * scoreCPU +
        SCORE_WEIGHTS.memory * scoreMem +
        SCORE_WEIGHTS.ledger * scoreLedger,
    );

    return {
      cpu: scoreCPU,
      memory: scoreMem,
      ledger: scoreLedger,
      total: scoreTotal,
    };
  }

  /**
   * Convert utilization (0-1) to score (100-0)
   */
  private scoreDimension(
    utilization: number,
    thresholdLow: number = 0.5,
    thresholdHigh: number = 0.8,
  ): number {
    let score: number;

    if (utilization < thresholdLow) {
      // Excellent band: 100 -> 80
      score = this.interpolate(utilization, 0, thresholdLow, 100, 80);
    } else if (utilization < thresholdHigh) {
      // Good band: 80 -> 50
      score = this.interpolate(
        utilization,
        thresholdLow,
        thresholdHigh,
        80,
        50,
      );
    } else {
      // Poor band: 50 -> 0
      score = this.interpolate(utilization, thresholdHigh, 1.0, 50, 0);
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Linear interpolation helper
   */
  private interpolate(
    val: number,
    inMin: number,
    inMax: number,
    outMin: number,
    outMax: number,
  ): number {
    if (inMax === inMin) {
      return outMin;
    }
    const ratio = (val - inMin) / (inMax - inMin);
    return outMin + ratio * (outMax - outMin);
  }

  /**
   * Generate actionable optimization hints based on resource usage
   */
  private generateHints(
    cpu: CPUCost,
    mem: MemoryCost,
    ledger: LedgerCost,
  ): string[] {
    const hints: string[] = [];

    // CPU hints
    if (cpu.normalized > 0.8) {
      hints.push(
        `CRITICAL: CPU usage at ${(cpu.normalized * 100).toFixed(0)}%. Reduce instruction count.`,
      );
    } else if (cpu.normalized > 0.6) {
      hints.push("HIGH CPU: Optimize hot loops and host function calls.");
    }

    if (cpu.ledgerPressure > 0.5) {
      const pressurePct = Math.sqrt(cpu.ledgerPressure);
      hints.push(
        `High ledger CPU pressure (${(pressurePct * 100).toFixed(1)}%).`,
      );
    }

    // Memory hints
    if (mem.normalized > 0.7) {
      hints.push(
        `CRITICAL: Memory usage at ${(mem.normalized * 100).toFixed(0)}%. Optimize allocations.`,
      );
    } else if (mem.normalized > 0.5) {
      hints.push("MODERATE memory usage. Review data structure sizes.");
    }

    // Ledger hints
    const ledgerLabels: Record<string, string> = {
      readEntries: "read entry count",
      writeEntries: "write entry count",
      readBytes: "read byte volume",
      writeBytes: "write byte volume",
      bandwidth: "transaction size",
    };

    const ledgerEntries = Object.entries(ledger.breakdown);
    for (const [key, util] of ledgerEntries) {
      if (util > 0.75) {
        hints.push(
          `HIGH ${ledgerLabels[key]}. Consider batching or compression.`,
        );
      }
    }

    // Cross-dimension hints
    if (cpu.normalized > 0.7 && ledger.breakdown.readEntries > 0.5) {
      hints.push(
        "TIP: High CPU + reads. Check for redundant storage accesses.",
      );
    }

    if (hints.length === 0) {
      hints.push("✅ Excellent resource efficiency!");
    }

    return hints;
  }

  /**
   * Check for safety violations (95% hard limit threshold)
   */
  private checkSafetyViolations(
    cpu: CPUCost,
    mem: MemoryCost,
    ledger: LedgerCost,
  ): string[] {
    const violations: string[] = [];

    if (cpu.normalized > 0.95) {
      violations.push("CPU exceeds 95% safety margin");
    }

    if (mem.normalized > 0.95) {
      violations.push("Memory exceeds 95% safety margin");
    }

    if (ledger.breakdown.readEntries > 0.95) {
      violations.push("Ledger read entries exceed 95% safety margin");
    }

    if (ledger.breakdown.writeEntries > 0.95) {
      violations.push("Ledger write entries exceed 95% safety margin");
    }

    if (ledger.breakdown.readBytes > 0.95) {
      violations.push("Ledger read bytes exceed 95% safety margin");
    }

    if (ledger.breakdown.writeBytes > 0.95) {
      violations.push("Ledger write bytes exceed 95% safety margin");
    }

    if (ledger.breakdown.bandwidth > 0.95) {
      violations.push("Transaction bandwidth exceeds 95% safety margin");
    }

    return violations;
  }

  /**
   * Calculate estimation confidence based on simulation quality
   */
  private calculateConfidence(
    simulation: SimulationResult,
    config: StellarNetworkConfig,
  ): number {
    let confidence = 100;

    // Reduce confidence if approaching limits
    if (simulation.instructions / config.txMaxInstructions > 0.8) {
      confidence -= 10;
    }

    if (simulation.memoryBytes / config.txMemoryLimit > 0.8) {
      confidence -= 10;
    }

    // Reduce confidence for high ledger utilization
    const ledgerUtilization =
      (simulation.resources.readBytes / config.txMaxReadBytes +
        simulation.resources.writeBytes / config.txMaxWriteBytes) /
      2;

    if (ledgerUtilization > 0.8) {
      confidence -= 10;
    }

    return Math.max(0, Math.min(100, confidence));
  }

  /**
   * Get default network configuration for a chain ID
   */
  static getDefaultConfig(chainId: string): StellarNetworkConfig {
    const config = DEFAULT_NETWORK_CONFIGS[chainId];
    if (!config) {
      throw new Error(`No default configuration for chain: ${chainId}`);
    }
    return config;
  }

  /**
   * Register a custom network configuration
   */
  static registerNetworkConfig(config: StellarNetworkConfig): void {
    DEFAULT_NETWORK_CONFIGS[config.chainId] = config;
  }
}
