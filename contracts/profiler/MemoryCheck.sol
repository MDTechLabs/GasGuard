// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MemoryCheck
/// @notice On-chain instrumentation for inspecting EVM free-memory-pointer
/// growth and quadratic memory-expansion gas costs, complementing GasGuard's
/// static `memory_profiler` analyzer (`gasguard-cli/src/analyzers`) with
/// runtime ground-truth measurements.
/// @dev The EVM's memory expansion cost formula is
/// `C_mem(a) = 3a + floor(a^2 / 512)`, where `a` is the highest memory
/// offset touched so far, expressed in 32-byte words.
contract MemoryCheck {
    /// @dev Memory slot the Solidity convention reserves for the free
    /// memory pointer.
    uint256 private constant FREE_MEMORY_POINTER_SLOT = 0x40;

    /// @notice Allocations at or above this size are flagged as a critical
    /// quadratic-expansion risk.
    uint256 public constant CRITICAL_ALLOCATION_THRESHOLD = 1024;

    /// @notice Emitted after {simulateAllocation} records a new allocation.
    event MemoryUsageRecorded(bytes32 indexed label, uint256 freeMemoryPointer, uint256 expansionGasCost, bool critical);

    /// @notice Reads the current free memory pointer directly from memory.
    function freeMemoryPointer() public pure returns (uint256 ptr) {
        assembly {
            ptr := mload(FREE_MEMORY_POINTER_SLOT)
        }
    }

    /// @notice Computes the EVM memory expansion cost for a region of
    /// `sizeBytes`, using the canonical formula on the size rounded up to a
    /// whole number of 32-byte words.
    function memoryExpansionCost(uint256 sizeBytes) public pure returns (uint256 cost) {
        uint256 words = (sizeBytes + 31) / 32;
        cost = 3 * words + (words * words) / 512;
    }

    /// @notice True if a `sizeBytes` allocation exceeds the critical
    /// quadratic-expansion threshold.
    function isCriticalAllocation(uint256 sizeBytes) public pure returns (bool) {
        return sizeBytes > CRITICAL_ALLOCATION_THRESHOLD;
    }

    /// @notice Allocates a scratch memory buffer of `sizeBytes`, measures how
    /// far the free memory pointer actually moved, and emits the resulting
    /// expansion cost and critical-risk flag for off-chain tooling to
    /// correlate against the static analyzer's predictions.
    /// @param label Caller-supplied identifier (e.g. the function under
    /// review) so results are attributable in logs.
    /// @param sizeBytes Size of the scratch buffer to allocate.
    function simulateAllocation(bytes32 label, uint256 sizeBytes)
        external
        returns (uint256 delta, uint256 cost, bool critical)
    {
        uint256 before = freeMemoryPointer();
        bytes memory scratch = new bytes(sizeBytes);
        require(scratch.length == sizeBytes, "MemoryCheck: alloc mismatch");

        delta = freeMemoryPointer() - before;
        cost = memoryExpansionCost(delta);
        critical = isCriticalAllocation(delta);

        emit MemoryUsageRecorded(label, freeMemoryPointer(), cost, critical);
    }
}
