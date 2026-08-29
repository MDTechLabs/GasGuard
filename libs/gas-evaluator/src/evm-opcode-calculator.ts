export interface EvmOpcodeDiff {
  opcode: string;
  originalGas: number;
  optimizedGas: number;
  description: string;
}

export interface GasDeltaResult {
  deltaGas: number;
  percentageReduction: number;
  description: string;
}

export class EvmOpcodeCalculator {
  // Gas cost schedules based on current EVM specs
  private readonly gasSchedule = {
    SLOAD_COLD: 2100,
    SLOAD_WARM: 100,
    SSTORE_SET: 20000,
    SSTORE_RESET: 2900,
    SSTORE_WARM: 100,
    MLOAD: 3,
    MSTORE: 3,
    CALL_COLD: 2600,
    CALL_WARM: 100,
    LOG_BASE: 375,
    LOG_TOPIC: 375,
    LOG_BYTE: 8,
    MATH_CHECK: 85,
    JUMP: 8,
    JUMPI: 10,
  };

  /**
   * Calculates the gas delta for a given Solidity optimization rule
   */
  public calculateDelta(
    ruleName: string,
    occurrences: number = 1,
    params: {
      loopIterations?: number;
      isCold?: boolean;
      byteSize?: number;
      numberOfTopics?: number;
    } = {}
  ): GasDeltaResult {
    const loopIterations = params.loopIterations || 10;
    const isCold = params.isCold !== false; // Default to true (cold storage access is common first time)
    const byteSize = params.byteSize || 32;
    const numberOfTopics = params.numberOfTopics || 1;

    let deltaGas = 0;
    let originalGasEstimate = 0;
    let description = "";

    const sloadCost = isCold ? this.gasSchedule.SLOAD_COLD : this.gasSchedule.SLOAD_WARM;
    const callCost = isCold ? this.gasSchedule.CALL_COLD : this.gasSchedule.CALL_WARM;

    switch (ruleName) {
      case "inefficient-storage-access":
      case "redundant-state-variable-reads": {
        // Caching a storage read in memory
        // Original: N reads from storage -> N * SLOAD
        // Optimized: 1 read from storage + N reads from memory -> 1 * SLOAD + N * MLOAD
        const original = sloadCost * occurrences;
        const optimized = sloadCost + (occurrences - 1) * this.gasSchedule.MLOAD;
        deltaGas = Math.max(0, original - optimized);
        originalGasEstimate = original;
        description = `Cached ${occurrences} state variable reads from storage (${sloadCost} gas) into memory (${this.gasSchedule.MLOAD} gas).`;
        break;
      }

      case "repeated-external-calls": {
        // Caching external call results in memory
        // Original: N calls -> N * CALL
        // Optimized: 1 call + (N-1) memory reads -> 1 * CALL + (N-1) * MLOAD
        const original = callCost * occurrences;
        const optimized = callCost + (occurrences - 1) * this.gasSchedule.MLOAD;
        deltaGas = Math.max(0, original - optimized);
        originalGasEstimate = original;
        description = `Cached ${occurrences} external contract calls in memory to avoid redundant CALL opcodes.`;
        break;
      }

      case "unused-state-variables": {
        // Unused state variable consumes initialization and storage reads
        // Saving the SSTORE of initializing it + potential SLOADs
        const original = this.gasSchedule.SSTORE_SET + sloadCost * occurrences;
        deltaGas = original;
        originalGasEstimate = original;
        description = `Removed unused state variable declarations, saving SSTORE initialization and subsequent reads.`;
        break;
      }

      case "large-storage-arrays": {
        // Unbounded storage array processing (looping and SLOADing each item)
        // Caching or indexing avoids excessive reads
        const original = (sloadCost + this.gasSchedule.MLOAD) * loopIterations;
        const optimized = sloadCost + this.gasSchedule.MLOAD * loopIterations;
        deltaGas = Math.max(0, original - optimized);
        originalGasEstimate = original;
        description = `Optimized storage array iteration over ${loopIterations} elements by caching array references in memory.`;
        break;
      }

      case "inefficient-loop-operations": {
        // Increment logic (++i vs i++) or caching length
        // ++i saves approx 5 gas per iteration compared to i++
        const lengthCacheSavings = lengthCacheSavingsVal(sloadCost, loopIterations);
        const incrementSavings = 5 * loopIterations;
        deltaGas = (lengthCacheSavings + incrementSavings) * occurrences;
        originalGasEstimate = (sloadCost * loopIterations + 15 * loopIterations) * occurrences;
        description = `Optimized loop structure by implementing pre-increments and caching collection limits.`;
        break;
      }

      case "unchecked-math-operations": {
        // Solidity 0.8+ checked math vs unchecked block
        // Checked math adds JUMPI and overflow comparisons (~85 gas per operation)
        const original = (this.gasSchedule.MATH_CHECK + 10) * occurrences;
        const optimized = 10 * occurrences; // raw execution without checks
        deltaGas = Math.max(0, original - optimized);
        originalGasEstimate = original;
        description = `Used unchecked block for safe math operations to skip compiler-generated bounds check opcodes.`;
        break;
      }

      case "excessive-event-logging": {
        // Redundant or overly verbose event logging
        // LOG base + topics + bytes
        const logCost =
          this.gasSchedule.LOG_BASE +
          this.gasSchedule.LOG_TOPIC * numberOfTopics +
          this.gasSchedule.LOG_BYTE * byteSize;
        deltaGas = logCost * occurrences;
        originalGasEstimate = logCost * occurrences;
        description = `Removed ${occurrences} redundant event logs (LOG${numberOfTopics} opcodes).`;
        break;
      }

      case "string-concatenation-loops": {
        // Concatenating strings inside loops causes frequent MSTORE and memory expansion
        // Pre-allocating or optimizing saves around 150 gas per iteration
        const iterationSavings = 150 * loopIterations;
        deltaGas = iterationSavings * occurrences;
        originalGasEstimate = (250 * loopIterations) * occurrences;
        description = `Optimized string operations inside loops to mitigate dynamic memory allocation and expansion costs.`;
        break;
      }

      case "dead-code": {
        // Dead branches, unused private functions
        // Removes unused JUMP/JUMPI instructions and associated logic
        const baseDeadCodeGas = 100;
        deltaGas = baseDeadCodeGas * occurrences;
        originalGasEstimate = baseDeadCodeGas * occurrences;
        description = `Trimmed dead code and unreachable execution branches.`;
        break;
      }

      case "inefficient-type-casting": {
        // Bitwise operations (AND, OR, SIGNEXTEND) to pack/unpack types unnecessarily
        // Typically saves ~15 gas per occurrence
        const savingsPerCasting = 15;
        deltaGas = savingsPerCasting * occurrences;
        originalGasEstimate = 40 * occurrences;
        description = `Optimized type casting by avoiding unnecessary bitwise masking opcodes.`;
        break;
      }

      default:
        deltaGas = 0;
        originalGasEstimate = 1; // Prevent division by zero
        description = `No differential model defined for Solidity rule: ${ruleName}.`;
        break;
    }

    const percentageReduction = originalGasEstimate > 0
      ? parseFloat(((deltaGas / originalGasEstimate) * 100).toFixed(2))
      : 0;

    return {
      deltaGas,
      percentageReduction,
      description,
    };
  }
}

function lengthCacheSavingsVal(sloadCost: number, loopIterations: number): number {
  return sloadCost * (loopIterations - 1);
}
