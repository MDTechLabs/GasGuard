export interface ResourceDelta {
  instructions: number;
  readEntries: number;
  writeEntries: number;
  readBytes: number;
  writeBytes: number;
  transactionSizeBytes: number;
}

export interface ResourceDeltaResult {
  delta: ResourceDelta;
  deltaFeeStroops: number;
  description: string;
}

export class SorobanResourceCalculator {
  // Stellar mainnet resource fee schedules
  private readonly feeSchedule = {
    FEE_CPU_PER_10000: 100, // 100 stroops per 10,000 instructions
    FEE_READ_LEDGER_ENTRY: 1000, // 1000 stroops per read entry
    FEE_WRITE_LEDGER_ENTRY: 2000, // 2000 stroops per write entry
    FEE_READ_1KB: 500, // 500 stroops per 1KB read
    FEE_WRITE_1KB: 1000, // 1000 stroops per 1KB write
    FEE_TX_SIZE_1KB: 100, // 100 stroops per 1KB transaction size
  };

  /**
   * Calculates the resource savings and fee reduction in stroops for a Soroban rule
   */
  public calculateDelta(
    ruleName: string,
    occurrences: number = 1,
    params: {
      dataSize?: number;
      numberOfReads?: number;
      loopIterations?: number;
    } = {}
  ): ResourceDeltaResult {
    const dataSize = params.dataSize || 64; // Default data size in bytes
    const numberOfReads = params.numberOfReads || 1;
    const loopIterations = params.loopIterations || 10;

    let instructions = 0;
    let readEntries = 0;
    let writeEntries = 0;
    let readBytes = 0;
    let writeBytes = 0;
    let transactionSizeBytes = 0;
    let description = "";

    switch (ruleName) {
      case "unused-state-variables":
      case "soroban-unused-state-variables":
        // Removing unused state variables prevents reading and writing them
        // Saves 1 read entry, 1 write entry, read/write serialization CPU instructions, and byte footprint
        readEntries = 1 * occurrences;
        writeEntries = 1 * occurrences;
        readBytes = dataSize * occurrences;
        writeBytes = dataSize * occurrences;
        // Host function call overhead + serialization (approx 15,000 CPU instructions per read/write)
        instructions = 30000 * occurrences;
        description = `Eliminated storage footprint for unused state variable (saves entry read/write and serialization overhead).`;
        break;

      case "soroban-inefficient-integers":
        // u128/i128 arithmetic is done via host calls, costing ~5000 instructions per operation
        // u32/i32 arithmetic is done in WASM, costing ~10 instructions
        instructions = 4990 * occurrences * loopIterations;
        description = `Substituted heap-allocated i128/u128 arithmetic operations with native WASM u32/i32 instructions.`;
        break;

      case "soroban-expensive-strings":
        // Using Symbols/compact forms instead of dynamic String references
        // Saves dynamic serialization overhead, symbol check instructions, and tx size
        transactionSizeBytes = Math.max(16, dataSize - 8) * occurrences; // saves ~16-48 bytes per string
        instructions = 12000 * occurrences; // ~12k instructions saved per symbol resolution
        description = `Replaced dynamic String usage with compact Symbol representation to lower transaction footprint.`;
        break;

      case "soroban-redundant-storage-reads":
        // Caching storage access inside a contract function
        // Avoids multiple read entries and bytes
        readEntries = (numberOfReads - 1) * occurrences;
        readBytes = dataSize * (numberOfReads - 1) * occurrences;
        instructions = 15000 * (numberOfReads - 1) * occurrences; // saves 15k instructions per host storage read
        description = `Cached ledger state variable reads in WASM memory to prevent redundant persistent storage queries.`;
        break;

      case "soroban-inefficient-bytes-allocation":
        // Dynamic resizing vector copy / allocations in WASM memory
        // Pre-allocating saves CPU instructions
        instructions = 2500 * loopIterations * occurrences;
        description = `Optimized memory allocation bounds to prevent dynamic resizing overhead inside execution loop.`;
        break;

      default:
        description = `No resource differential model defined for Soroban rule: ${ruleName}.`;
        break;
    }

    const deltaFeeStroops = this.calculateStroops({
      instructions,
      readEntries,
      writeEntries,
      readBytes,
      writeBytes,
      transactionSizeBytes,
    });

    return {
      delta: {
        instructions,
        readEntries,
        writeEntries,
        readBytes,
        writeBytes,
        transactionSizeBytes,
      },
      deltaFeeStroops,
      description,
    };
  }

  /**
   * Helper to convert resource delta into total fee in stroops
   */
  private calculateStroops(delta: ResourceDelta): number {
    const cpuFee = Math.ceil(delta.instructions / 10000) * this.feeSchedule.FEE_CPU_PER_10000;
    const readEntryFee = delta.readEntries * this.feeSchedule.FEE_READ_LEDGER_ENTRY;
    const writeEntryFee = delta.writeEntries * this.feeSchedule.FEE_WRITE_LEDGER_ENTRY;
    const readByteFee = Math.ceil(delta.readBytes / 1024) * this.feeSchedule.FEE_READ_1KB;
    const writeByteFee = Math.ceil(delta.writeBytes / 1024) * this.feeSchedule.FEE_WRITE_1KB;
    const txSizeFee = Math.ceil(delta.transactionSizeBytes / 1024) * this.feeSchedule.FEE_TX_SIZE_1KB;

    return cpuFee + readEntryFee + writeEntryFee + readByteFee + writeByteFee + txSizeFee;
  }
}
